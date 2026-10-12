import { CallbackChannel } from './channel.js';
import { CopyingChannel } from './copy-channel.js';
import type { CopyPolicy } from './copy-channel.js';
import { compileJsonPath } from './jsonpath.js';
import { childrenOf, EMPTY_CONTEXT, makeRootContext, newNode, stepContext } from './selectors.js';
import type { Context, Node } from './selectors.js';
import { Any, Rest } from './types.js';
import type {
    CallbackObserver,
    Parser,
    Path,
    PathInput,
    Subscription,
    ValueCallback,
} from './types.js';

export type SelectorDefinition = PathInput | { path: PathInput; kind: 'value' | 'string' };
export type SelectorPlan = {
    /** Bind in definition order. Channels and cancellation belong to this parser only. */
    bind(
        parser: Parser,
        callbacks: readonly (ValueCallback<any> | CallbackObserver<any>)[],
    ): Subscription[];
};
/** Internal bridge: plans never access scanner state or install scanner methods. */
// Share the descriptor protocol between ESM/CJS and duplicate package installations.
export const BIND_SELECTORS = Symbol.for('@sapientpro/json-stream/selector-plan/bind/v1');
type Shape = {
    children: [string, number][];
    indexes: [string, number][];
    any: number | undefined;
    rest: number | undefined;
    tail: boolean | undefined;
    continuation: boolean | undefined;
};
type Transition = {
    nodes: number[];
    hasValues: boolean;
    indexed: boolean;
    recursive: boolean;
    edges: [string, number][];
    indexes: [string, number][];
    fallback: number;
};
export type CompiledSelectors = {
    paths: Path[];
    strings: boolean[];
    bindings: number[];
    shape: Shape[];
    transitions: Transition[];
};

/** Compile a fixed subscription layout for many independent documents. No global cache. */
export function compileSelectors(definitions: readonly SelectorDefinition[]): SelectorPlan {
    if (!Array.isArray(definitions)) throw new TypeError('Selector definitions must be an array');
    const data: CompiledSelectors = {
        paths: [],
        strings: [],
        bindings: [],
        shape: [],
        transitions: [],
    };
    const root = newNode();
    const bindingNodes: Node[] = [];
    for (const definition of definitions) {
        const detailed =
            definition !== null && typeof definition === 'object' && !Array.isArray(definition);
        const entry = definition as { path: PathInput; kind: 'value' | 'string' };
        if (detailed && entry.kind !== 'value' && entry.kind !== 'string')
            throw new TypeError('Selector kind must be value or string');
        const input = detailed ? entry.path : (definition as PathInput);
        if (typeof input !== 'string' && !Array.isArray(input))
            throw new TypeError('A JSONPath string or selector array is required');
        const path: Path =
            typeof input === 'string' ? compileJsonPath(input) : Object.freeze([...input]);
        const string = detailed && entry.kind === 'string';
        data.paths.push(path);
        data.strings.push(string);
        const node = selectNode(root, path);
        bindingNodes.push(node);
        // Compilation uses only the observed flag; no consumer callback is retained in the plan.
        const channel = (node[string ? 'fragments' : 'callbacks'] ??= new CallbackChannel(
            () => {},
        ));
        channel.add({ next: () => {} });
    }
    const nodes: Node[] = [],
        ids = new Map<Node, number>();
    const pending = [root];
    while (pending.length) {
        const node = pending.pop()!;
        ids.set(node, nodes.length);
        nodes.push(node);
        for (const child of childrenOf(node)) pending.push(child);
    }
    data.bindings = bindingNodes.map((node) => ids.get(node)!);
    data.shape = nodes.map((node) => ({
        children: Object.entries(node.children).map(([key, child]) => [key, ids.get(child)!]),
        indexes: Object.entries(node.indexes).map(([key, child]) => [key, ids.get(child)!]),
        any: node.any ? ids.get(node.any)! : undefined,
        rest: node.rest ? ids.get(node.rest)! : undefined,
        tail: node.tail,
        continuation: node.continuation,
    }));
    // Root-only bindings already have a specialized builder; preparing a graph adds no benefit.
    if (nodes.length > 1) data.transitions = compileTransitions(root, ids);
    return Object.freeze({
        bind(parser: Parser, callbacks: readonly (ValueCallback<any> | CallbackObserver<any>)[]) {
            if (!Array.isArray(callbacks) || callbacks.length !== data.paths.length)
                throw new TypeError('Provide one callback for each selector');
            const observers = Array.from(callbacks, (callback) => {
                const observer = typeof callback === 'function' ? { next: callback } : callback;
                if (!observer || typeof observer.next !== 'function')
                    throw new TypeError('A next callback is required');
                return observer;
            });
            const bind = (
                parser as Parser & {
                    [BIND_SELECTORS]?: (
                        data: CompiledSelectors,
                        observers: CallbackObserver<any>[],
                    ) => Subscription[];
                }
            )?.[BIND_SELECTORS];
            if (typeof bind !== 'function')
                throw new TypeError('Selector plans require a JSON or JSON5 parser');
            return bind.call(parser, data, observers);
        },
    });
}

/** Cold plan construction mirrors ordinary registration without changing its measured path. */
export function selectNode(root: Node, path: Path): Node {
    for (const key of path) {
        if (typeof key === 'number' && (!Number.isSafeInteger(key) || key < 0))
            throw new TypeError('Array selectors must be nonnegative safe integers');
        if (typeof key !== 'number' && typeof key !== 'string' && key !== Any && key !== Rest)
            throw new TypeError('Invalid selector segment');
    }
    let node = root;
    for (const key of path) {
        if (node.tail) node.continuation = true;
        node =
            key === Any
                ? (node.any ??= newNode())
                : key === Rest
                  ? (node.rest ??= newNode())
                  : typeof key === 'number'
                    ? (node.indexes[key] ??= newNode())
                    : (node.children[key] ??= newNode());
        if (key === Rest) {
            node.tail = true;
            root.hasRest = true;
        }
    }
    return node;
}

function compileTransitions(root: Node, ids: Map<Node, number>): Transition[] {
    const contexts: Context[] = [],
        seen = new Map<string, number>();
    const keyOf = (context: Context) => context.nodes.map((node) => ids.get(node)!).join(',');
    let edges = 0,
        exceeded = false;
    const intern = (context: Context): number => {
        if (context === EMPTY_CONTEXT) return -1;
        const key = keyOf(context);
        const cached = seen.get(key);
        if (cached !== undefined) return cached;
        const slots = Object.keys(context.edges).length + Object.keys(context.indexes).length + 1;
        if (contexts.length >= 4096 || edges + slots > 65536) {
            exceeded = true;
            return -1;
        }
        edges += slots;
        const id = contexts.length;
        seen.set(key, id);
        contexts.push(context);
        return id;
    };
    intern(makeRootContext(root));
    for (let i = 0; i < contexts.length; ++i) {
        // Recursive selectors can produce many combinations. Fall back to lazy contexts,
        // preserving matching semantics instead of imposing a new selector restriction.
        if (exceeded) return [];
        const context = contexts[i]!;
        const properties = Object.keys(context.edges),
            indexes = Object.keys(context.indexes);
        for (const key of properties) {
            intern(stepContext(context, key));
            if (exceeded) return [];
        }
        for (const key of indexes) {
            intern(stepContext(context, Number(key)));
            if (exceeded) return [];
        }
        // A string not present among exact edges represents the shared wildcard fallback.
        let fallback = '';
        while (Object.hasOwn(context.edges, fallback)) fallback += '\0';
        intern(stepContext(context, fallback));
        if (exceeded) return [];
    }
    if (exceeded) return [];
    const idOf = (context: Context) => (context === EMPTY_CONTEXT ? -1 : seen.get(keyOf(context))!);
    return contexts.map((context) => ({
        nodes: context.nodes.map((node) => ids.get(node)!),
        hasValues: context.hasValues,
        indexed: context.indexed,
        recursive: context.recursive,
        edges: Object.entries(context.edges).map(([key, next]) => [key, idOf(next!)]),
        indexes: Object.entries(context.indexes).map(([key, next]) => [key, idOf(next!)]),
        fallback: idOf(context.fallback!),
    }));
}

export function bindSelectors(
    data: CompiledSelectors,
    observers: CallbackObserver<any>[],
    report: (error: unknown) => void,
    copyPolicy?: CopyPolicy,
): { root: Node; context: Context | undefined; subscriptions: Subscription[]; hasChunks: boolean } {
    const nodes = data.shape.map((shape) => {
        const node = newNode();
        if (shape.tail) node.tail = true;
        if (shape.continuation) node.continuation = true;
        return node;
    });
    data.shape.forEach((shape, i) => {
        const node = nodes[i]!;
        for (const [key, id] of shape.children) node.children[key] = nodes[id]!;
        for (const [key, id] of shape.indexes) node.indexes[Number(key)] = nodes[id]!;
        node.any = shape.any === undefined ? undefined : nodes[shape.any];
        node.rest = shape.rest === undefined ? undefined : nodes[shape.rest];
        if (shape.rest !== undefined) nodes[0]!.hasRest = true;
    });
    const subscriptions = observers.map((observer, i) => {
        const node = nodes[data.bindings[i]!]!,
            slot = data.strings[i] ? 'fragments' : 'callbacks';
        return (node[slot] ??= copyPolicy
            ? new CopyingChannel(report, copyPolicy)
            : new CallbackChannel(report)).add(observer);
    });
    const contexts: Context[] = data.transitions.map((transition) => ({
        nodes: transition.nodes.map((id) => nodes[id]!),
        hasValues: transition.hasValues,
        edges: Object.create(null),
        indexes: Object.create(null),
        indexed: transition.indexed,
        recursive: transition.recursive,
    }));
    const get = (id: number) => (id < 0 ? EMPTY_CONTEXT : contexts[id]!);
    data.transitions.forEach((transition, i) => {
        const context = contexts[i]!;
        for (const [key, id] of transition.edges) context.edges[key] = get(id);
        for (const [key, id] of transition.indexes) context.indexes[key] = get(id);
        context.fallback = get(transition.fallback);
    });
    return {
        root: nodes[0]!,
        context: contexts[0],
        subscriptions,
        hasChunks: data.strings.includes(true),
    };
}
