import { Any, Rest } from './types.js';
import type { PathSegment } from './types.js';
import { CallbackChannel } from './channel.js';
export type Node = {
    callbacks?: CallbackChannel<any>;
    fragments?: CallbackChannel<string>;
    tail?: boolean;
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
    fallback?: Context;
};
export const EMPTY_CONTEXT: Context = { nodes: [], hasValues: false, edges: Object.create(null), indexes: Object.create(null), indexed: false };
export const makeContext = (nodes: Node[]): Context => {
    nodes = nodes.filter(node => node.callbacks?.observed || node.fragments?.observed || node.any || node.rest || Object.keys(node.children).length || Object.keys(node.indexes).length);
    if (!nodes.length)
        return EMPTY_CONTEXT;
    const edges: Context['edges'] = Object.create(null);
    const indexes: Context['indexes'] = Object.create(null);
    let hasValues = false;
    for (const node of nodes) {
        if (node.callbacks?.observed) hasValues = true;
        if (!node.tail) {
            for (const key of Object.keys(node.children))
                edges[key] = null;
            for (const key of Object.keys(node.indexes))
                indexes[Number(key)] = null;
        }
    }
    return { nodes, hasValues, edges, indexes, indexed: Object.keys(indexes).length > 0 };
};
export const stepContext = (context: Context, key: PathSegment): Context => {
    if (context === EMPTY_CONTEXT)
        return EMPTY_CONTEXT;
    const numeric = typeof key === 'number';
    const edges = numeric ? context.indexes : context.edges;
    const cached = edges[key];
    if (cached)
        return cached;
    if (cached === undefined && context.fallback)
        return context.fallback;
    const nodes: Node[] = [];
    for (const node of context.nodes) {
        if (node.tail) {
            nodes.push(node);
            continue;
        }
        if (cached === null) {
            const exact = numeric ? node.indexes[key as number] : node.children[key];
            if (exact)
                nodes.push(exact);
        }
        if (node.any)
            nodes.push(node.any);
        if (node.rest)
            nodes.push(node.rest);
    }
    const next = makeContext(nodes);
    if (cached === null)
        edges[key] = next;
    else
        context.fallback = next;
    return next;
};
export type Frame = {
    container: any;
    isArray: boolean;
    key: string;
    count: number;
    context: Context;
    arrayContext: Context | undefined;
};
export const newNode = (): Node => ({ children: Object.create(null), indexes: Object.create(null), any: undefined, rest: undefined });
export const childrenOf = (node: Node): Node[] => {
    const out = [...Object.values(node.children), ...Object.values(node.indexes)];
    if (node.any)
        out.push(node.any!);
    if (node.rest)
        out.push(node.rest!);
    return out;
};
