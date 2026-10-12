/** Reject invalid option containers before destructuring/spreading loses their type. */
export function validateOptionsObject(options: unknown): void {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
        throw new TypeError('Parser options must be an object');
}
