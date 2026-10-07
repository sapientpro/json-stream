/** Enable measured V8-specific paths only on known runtimes; browsers keep portable defaults. */
const runtime = globalThis as {Bun?: unknown; process?: {versions?: {v8?: string}}; Deno?: {version?: {v8?: string}}};
export const IS_V8 = typeof runtime.Bun === 'undefined' && !!(runtime.process?.versions?.v8 || runtime.Deno?.version?.v8);

// Reuse single Unicode units on Bun, where repeated conversion and concatenation
// are expensive. Other runtimes retain the native conversion path.
export const unicodeUnit = (() => {
    if (typeof (globalThis as {
        Bun?: unknown;
    }).Bun === 'undefined')
        return String.fromCharCode;
    const codes = new Int32Array(64).fill(-1);
    const strings: string[] = new Array(64).fill('');
    let misses = 0, cooldown = 0;
    return (value: number): string => {
        if (value < 256)
            return String.fromCharCode(value);
        if (cooldown > 0) {
            --cooldown;
            return String.fromCharCode(value);
        }
        const slot = value & 63;
        if (codes[slot] === value) {
            misses = 0;
            return strings[slot]!;
        }
        const text = String.fromCharCode(value);
        codes[slot] = value;
        strings[slot] = text;
        // Avoid repeated lookup/update costs for diverse or colliding characters.
        if (++misses === 16) {
            misses = 0;
            cooldown = 512;
        }
        return text;
    };
})();
export const hexDigit = (code: number): number => {
    if (code >= 48 && code <= 57)
        return code - 48;
    if (code >= 65 && code <= 70)
        return code - 55;
    if (code >= 97 && code <= 102)
        return code - 87;
    return -1;
};
export const readHex4 = (buf: string, pos: number): number => {
    const a = hexDigit(buf.charCodeAt(pos)), b = hexDigit(buf.charCodeAt(pos + 1));
    const c = hexDigit(buf.charCodeAt(pos + 2)), d = hexDigit(buf.charCodeAt(pos + 3));
    return (a | b | c | d) < 0 ? -1 : (a << 12) | (b << 8) | (c << 4) | d;
};
// Returns 1/2/3 for true/false/null, or 0 for the incremental path.
export const readLiteral = (buf: string, pos: number, len: number): number => {
    const first = buf.charCodeAt(pos);
    let literal = 0;
    if (first === 116 && buf.charCodeAt(pos + 1) === 114 && buf.charCodeAt(pos + 2) === 117 && buf.charCodeAt(pos + 3) === 101)
        literal = 1;
    else if (first === 102 && buf.charCodeAt(pos + 1) === 97 && buf.charCodeAt(pos + 2) === 108 && buf.charCodeAt(pos + 3) === 115 && buf.charCodeAt(pos + 4) === 101)
        literal = 2;
    else if (first === 110 && buf.charCodeAt(pos + 1) === 117 && buf.charCodeAt(pos + 2) === 108 && buf.charCodeAt(pos + 3) === 108)
        literal = 3;
    if (!literal)
        return 0;
    const end = pos + (literal === 2 ? 5 : 4);
    // A token at the chunk boundary must wait for continuation or end().
    if (end >= len)
        return 0;
    const next = buf.charCodeAt(end);
    return next >= 97 && next <= 122 ? 0 : literal;
};
export const isSpace = (code: number) => code === 32 || code === 10 || code === 13 || code === 9;
const IDENTIFIER = /^[$_\p{L}\p{Nl}][$_\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}\u200c\u200d]*$/u;
const IDENTIFIER_START = /^[$_\p{L}\p{Nl}]$/u;
const IDENTIFIER_PART = /^[$_\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}\u200c\u200d]$/u;
/** Validate each escaped identifier character before combining UTF-16 units. */
function decodeIdentifierUncached(text: string): string | undefined {
    if (!text.includes('\\'))
        return IDENTIFIER.test(text) ? text : undefined;
    let name = '';
    for (let i = 0; i < text.length;) {
        let char: string;
        if (text[i] === '\\') {
            if (text.slice(i, i + 2) !== '\\u' || i + 6 > text.length)
                return undefined;
            const code = readHex4(text, i + 2);
            if (code < 0 || code >= 0xD800 && code <= 0xDFFF)
                return undefined;
            char = String.fromCharCode(code);
            i += 6;
        }
        else {
            const code = text.codePointAt(i)!;
            char = String.fromCodePoint(code);
            i += char.length;
        }
        if (!(name.length ? IDENTIFIER_PART : IDENTIFIER_START).test(char))
            return undefined;
        name += char;
    }
    return name || undefined;
}

// Memoize complete, validated tokens; never use a prefix to skip tokenization.
const identifierMemo = new Array<{raw: string; name: string} | undefined>(64).fill(undefined);
let identifierMisses = 0, identifierHits = 0, identifierCooldown = 0;
export function decodeIdentifier(text: string): string | undefined {
    if (text.length > 64) return decodeIdentifierUncached(text);
    if (identifierCooldown > 0) {
        --identifierCooldown;
        return decodeIdentifierUncached(text);
    }
    const slot = text.charCodeAt(0) & 63;
    const cached = identifierMemo[slot];
    if (cached !== undefined && cached.raw === text) {
        if (++identifierHits === 64) identifierHits = identifierMisses = 0;
        return cached.name;
    }
    // Copy before validation: RegExp's last subject can also retain an input buffer.
    const raw = text.split('').join('');
    const name = decodeIdentifierUncached(raw);
    if (name !== undefined) {
        identifierMemo[slot] = {raw, name: name === raw ? raw : name.split('').join('')};
    }
    if (++identifierMisses === 16) {
        identifierHits = identifierMisses = 0;
        identifierCooldown = 4096;
    }
    return name;
}
