import {CallbackChannel} from './channel.js';
import type {PathSegment} from './types.js';

export type CopyPolicy = {large: boolean};

/** Short scalar results only: containers, paths and long strings keep their identity. */
function copyShort<T>(value: T, policy: CopyPolicy): T {
    if (!policy.large || typeof value !== 'string' || value.length > 128) return value;
    const length = value.length;
    if (length === 0) return '' as T;
    if (length === 1) return String.fromCharCode(value.charCodeAt(0)) as T;
    // Two nonempty parts detach sliced storage on the tested V8 and JSC versions.
    return [value.slice(0, 1), value.slice(1)].join('') as T;
}

export class CopyingChannel<T> extends CallbackChannel<T> {
    constructor(report: (error: unknown) => void, private readonly policy: CopyPolicy) { super(report); }
    next(value: T, path: readonly PathSegment[]): void { super.next(copyShort(value, this.policy), path); }
}
