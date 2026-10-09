import { Any, Rest } from './types.js';
import type { Path, Selector } from './types.js';
const ROOT_PATH: Path = Object.freeze([]);
/** Compile the streaming selector subset of RFC 9535 once. */
export function compileJsonPath(query: string): Path {
    // The root needs no selector parsing or helper closures.
    if (query === '$') return ROOT_PATH;
    if (typeof query !== 'string' || query[0] !== '$')
        throw new SyntaxError('JSONPath must start with $');
    const path: Selector[] = [];
    let i = 1;
    const fail = (): never => {
        throw new SyntaxError('Unsupported or invalid JSONPath syntax at ' + i);
    };
    const ws = () => {
        while (i < query.length && /[ \t\r\n]/.test(query[i]!)) ++i;
    };
    const scalar = (): string => {
        const code = query.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
            const low = query.charCodeAt(i + 1);
            if (!(low >= 0xdc00 && low <= 0xdfff)) fail();
            const text = query.slice(i, i + 2);
            i += 2;
            return text;
        }
        if (code >= 0xdc00 && code <= 0xdfff) fail();
        return query[i++]!;
    };
    const readHex = (): number => {
        const hex = query.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
        i += 4;
        return parseInt(hex, 16);
    };
    const quoted = (): string => {
        const quote = query[i++]!;
        let value = '';
        while (i < query.length) {
            if (query[i] === quote) {
                ++i;
                return value;
            }
            if (query.charCodeAt(i) < 32) fail();
            if (query[i] !== '\\') {
                value += scalar();
                continue;
            }
            ++i;
            const ch = query[i++];
            if (ch === 'u') {
                const code = readHex();
                if (code >= 0xd800 && code <= 0xdbff) {
                    if (query.slice(i, i + 2) !== '\\u') fail();
                    i += 2;
                    const low = readHex();
                    if (!(low >= 0xdc00 && low <= 0xdfff)) fail();
                    value += String.fromCharCode(code, low);
                } else {
                    if (code >= 0xdc00 && code <= 0xdfff) fail();
                    value += String.fromCharCode(code);
                }
            } else if (ch === quote || ch === '\\' || ch === '/') value += ch;
            else if (ch === 'b') value += '\b';
            else if (ch === 'f') value += '\f';
            else if (ch === 'n') value += '\n';
            else if (ch === 'r') value += '\r';
            else if (ch === 't') value += '\t';
            else fail();
        }
        return fail();
    };
    const nameFirst = (code: number) =>
        (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 128;
    while (i < query.length) {
        ws();
        if (i === query.length) fail();
        let recursive = false;
        if (query[i] === '.' && query[i + 1] === '.') {
            recursive = true;
            path.push(Rest);
            i += 2;
            if (query[i] !== '[' && query[i] !== '*' && !nameFirst(query.charCodeAt(i))) fail();
        }
        if (query[i] === '.' || (recursive && query[i] !== '[')) {
            if (!recursive) ++i;
            if (query[i] === '*') {
                ++i;
                // A terminal recursive wildcard has the same semantics as terminal Rest.
                if (!recursive || i < query.length) path.push(Any);
                continue;
            }
            if (!nameFirst(query.charCodeAt(i))) fail();
            let name = scalar();
            while (i < query.length && (nameFirst(query.charCodeAt(i)) || /[0-9]/.test(query[i]!)))
                name += scalar();
            path.push(name);
        } else if (query[i] === '[') {
            ++i;
            ws();
            if (query[i] === '*') {
                ++i;
                path.push(Any);
            } else if (query[i] === '"' || query[i] === "'") path.push(quoted());
            else {
                const start = i;
                while (i < query.length && /[0-9]/.test(query[i]!)) ++i;
                const text = query.slice(start, i);
                if (!/^(0|[1-9][0-9]*)$/.test(text)) fail();
                const index = Number(text);
                if (!Number.isSafeInteger(index)) fail();
                path.push(index);
            }
            ws();
            if (query[i++] !== ']') fail();
            if (recursive && i === query.length && path[path.length - 1] === Any) path.pop();
        } else fail();
    }
    return Object.freeze(path);
}
