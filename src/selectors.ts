import type { PathSegment } from './types.js';
import type { CallbackChannel } from './channel.js';
export type Node = {
    /** Root-only registration hint; ordinary selectors need no interning pool. */
    hasRest?: boolean;
    callbacks?: CallbackChannel<any>;
    fragments?: CallbackChannel<string>;
    tail?: boolean;
    /** This recursive state has a suffix, rather than only terminal consumers. */
    continuation?: boolean;
    children: {
        [key: string]: Node;
    };
    indexes: {
        [key: number]: Node;
    };
    any: Node | undefined;
    rest: Node | undefined;
};
export type Context = {
    nodes: Node[];
    /** Conservative snapshot: consumers can unsubscribe, but cannot register after parsing starts. */
    hasValues: boolean;
    edges: {
        [key: string]: Context | null;
    };
    indexes: {
        [key: string]: Context | null;
    };
    indexed: boolean;
    recursive: boolean;
    fallback?: Context;
    /** Per-parser recursive cache; attached only to recursive selector contexts. */
    cache?: ContextCache;
    retained?: boolean;
};
export const EMPTY_CONTEXT: Context = {
    nodes: [],
    hasValues: false,
    edges: Object.create(null),
    indexes: Object.create(null),
    indexed: false,
    recursive: false,
};
export const makeContext = (nodes: Node[]): Context => {
    nodes = nodes.filter(
        (node) =>
            node.callbacks?.observed ||
            node.fragments?.observed ||
            node.any ||
            node.rest ||
            Object.keys(node.children).length ||
            Object.keys(node.indexes).length,
    );
    if (!nodes.length) return EMPTY_CONTEXT;
    const edges: Context['edges'] = Object.create(null);
    const indexes: Context['indexes'] = Object.create(null);
    let hasValues = false;
    let recursive = false;
    for (const node of nodes) {
        if (node.callbacks?.observed) hasValues = true;
        if (node.continuation || node.rest?.continuation) recursive = true;
        if (!node.tail || node.continuation) {
            for (const key of Object.keys(node.children)) edges[key] = null;
            for (const key of Object.keys(node.indexes)) indexes[Number(key)] = null;
        }
        // Rest can match zero levels before its suffix; expose those exact edges too.
        for (let rest = node.rest; rest?.continuation; rest = rest.rest) {
            for (const key of Object.keys(rest.children)) edges[key] = null;
            for (const key of Object.keys(rest.indexes)) indexes[Number(key)] = null;
        }
    }
    return {
        nodes,
        hasValues,
        edges,
        indexes,
        indexed: Object.keys(indexes).length > 0,
        recursive,
    };
};

type ContextCache = {
    states: Context[];
    slots: number;
    ids?: Map<Node, number>;
    signatures?: Map<string, Context>;
};
const MAX_CONTEXTS = 4096;
const MAX_TRANSITIONS = 65536;
const contextKey = (nodes: Node[], ids: Map<Node, number>): string =>
    nodes
        .map((node) => {
            let id = ids.get(node);
            if (id === undefined) {
                id = ids.size;
                ids.set(node, id);
            }
            return id;
        })
        .join(',');
function findContext(nodes: Node[], cache: ContextCache): Context | undefined {
    // Most recursive selectors have only a few states. Avoid maps and string keys
    // for short documents, while keeping lookup bounded for larger selector graphs.
    if (!cache.signatures && cache.states.length < 16) {
        candidates: for (const state of cache.states) {
            if (state.nodes.length !== nodes.length) continue;
            for (let i = 0; i < nodes.length; i++)
                if (state.nodes[i] !== nodes[i]) continue candidates;
            return state;
        }
        return undefined;
    }
    if (!cache.signatures) {
        cache.ids = new Map();
        cache.signatures = new Map(
            cache.states.map((state) => [contextKey(state.nodes, cache.ids!), state]),
        );
    }
    return cache.signatures.get(contextKey(nodes, cache.ids!));
}
function retainContext(context: Context, cache: ContextCache): void {
    context.cache = cache;
    const slots = Object.keys(context.edges).length + Object.keys(context.indexes).length + 1;
    if (cache.states.length >= MAX_CONTEXTS || cache.slots + slots > MAX_TRANSITIONS) return;
    cache.states.push(context);
    context.retained = true;
    cache.signatures?.set(contextKey(context.nodes, cache.ids!), context);
    cache.slots += slots;
}
export function makeRootContext(root: Node): Context {
    const context = makeContext([root]);
    if (root.hasRest && context !== EMPTY_CONTEXT) {
        retainContext(context, { states: [], slots: 0 });
    }
    return context;
}
/** Called only on transition misses; cached transitions keep their ordinary fast path. */
function finishTransition(
    context: Context,
    nodes: Node[],
    edges: Context['edges'],
    key: PathSegment,
    cached: Context | null | undefined,
): Context {
    const cache = context.cache;
    let next = cache ? findContext(nodes, cache) : undefined;
    const existing = next !== undefined;
    next ??= makeContext(nodes);
    let remember = true;
    if (cache) {
        if (!existing && next !== EMPTY_CONTEXT) {
            const filtered =
                next.nodes.length !== nodes.length ? findContext(next.nodes, cache) : undefined;
            if (filtered) next = filtered;
            else retainContext(next, cache);
        }
        // A retained state must never point at an uncached state: that would bypass
        // the budget by retaining an unbounded transition tree through this edge.
        remember = context.retained === true && (next === EMPTY_CONTEXT || next.retained === true);
    }
    if (remember) {
        if (cached === null) edges[key] = next;
        else context.fallback = next;
    }
    return next;
}
export const stepContext = (context: Context, key: PathSegment): Context => {
    if (context === EMPTY_CONTEXT) return EMPTY_CONTEXT;
    const numeric = typeof key === 'number';
    const edges = numeric ? context.indexes : context.edges;
    const cached = edges[key];
    if (cached) return cached;
    if (cached === undefined && context.fallback) return context.fallback;
    if (context.recursive) return stepRecursiveContext(context, key, edges, cached);
    const nodes: Node[] = [];
    for (const node of context.nodes) {
        if (node.tail) {
            nodes.push(node);
            continue;
        }
        if (cached === null) {
            const exact = numeric ? node.indexes[key as number] : node.children[key];
            if (exact) nodes.push(exact);
        }
        if (node.any) nodes.push(node.any);
        if (node.rest) nodes.push(node.rest);
    }
    return finishTransition(context, nodes, edges, key, cached);
};
/** Recursive states persist while their suffix advances independently. */
const stepRecursiveContext = (
    context: Context,
    key: PathSegment,
    edges: Context['edges'],
    cached: Context | null | undefined,
): Context => {
    const nodes: Node[] = [];
    const add = (node: Node) => {
        if (!nodes.includes(node)) nodes.push(node);
    };
    const numeric = typeof key === 'number';
    for (const source of context.nodes) {
        for (let node: Node | undefined = source; node; node = node.rest) {
            // A recursive node consumes this level and remains available below it.
            if (node.tail) add(node);
            if (cached === null) {
                const exact = numeric ? node.indexes[key as number] : node.children[key];
                if (exact) add(exact);
            }
            if (node.any) add(node.any);
        }
    }
    return finishTransition(context, nodes, edges, key, cached);
};
export type Frame = {
    container: any;
    isArray: boolean;
    key: string;
    count: number;
    context: Context;
    arrayContext: Context | undefined;
};
export const newNode = (): Node => ({
    children: Object.create(null),
    indexes: Object.create(null),
    any: undefined,
    rest: undefined,
});
export const childrenOf = (node: Node): Node[] => {
    const out = [...Object.values(node.children), ...Object.values(node.indexes)];
    if (node.any) out.push(node.any!);
    if (node.rest) out.push(node.rest!);
    return out;
};
