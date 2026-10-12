import { CharCode } from './char-code.js';
import { decodeIdentifier, hexDigit } from './lexical.js';

const enum Expect {
    ArrayValue,
    ArrayNext,
    ObjectKey,
    Colon,
    ObjectValue,
    ObjectNext,
}
const enum Token {
    None,
    String,
    Escape,
    Hex,
    Zero,
    SkipLF,
    Identifier,
    Scalar,
}
const SPACE = /[\t\n\v\f\r \u00a0\ufeff\u2028\u2029\p{Zs}]/u;
const TOKEN_END = /[\t\n\v\f\r \u00a0\ufeff\u2028\u2029\p{Zs},:{}[\]/]/gu;
const DOUBLE_END = /["\\\r\n]/g;
const SINGLE_END = /['\\\r\n]/g;
const NUMBER =
    /^[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$/;

/** Validation-only JSON5 frames; no containers, decoded string values or selector paths. */
export class Json5SubtreeValidator {
    private stack: Expect[] = [];
    private token = Token.None;
    private quote: number = CharCode.QUOTE;
    private missing = 0;
    private comment = 0;
    private acc = '';
    private limit = 0;
    done = false;
    error = -1;
    depthExceeded = false;

    start(array: boolean, limit: number): void {
        this.stack.length = 0;
        this.stack.push(array ? Expect.ArrayValue : Expect.ObjectKey);
        this.token = Token.None;
        this.comment = 0;
        this.acc = '';
        this.limit = limit;
        this.done = false;
        this.error = -1;
        this.depthExceeded = false;
    }
    release(): void {
        this.stack.length = 0;
        this.acc = '';
        for (const pattern of [TOKEN_END, DOUBLE_END, SINGLE_END]) {
            pattern.lastIndex = 0;
            pattern.test(' ');
        }
    }
    run(buf: string, pos: number, len: number): number {
        while (pos < len) {
            if (this.token === Token.String) {
                const limit = Math.min(len, pos + 16);
                while (pos < limit) {
                    const code = buf.charCodeAt(pos);
                    if (
                        code === this.quote ||
                        code === CharCode.BACKSLASH ||
                        code === 13 ||
                        code === 10
                    )
                        break;
                    ++pos;
                }
                if (pos === len) return pos;
                if (pos === limit) {
                    const pattern = this.quote === CharCode.QUOTE ? DOUBLE_END : SINGLE_END;
                    pattern.lastIndex = pos;
                    if (!pattern.test(buf)) return len;
                    pos = pattern.lastIndex - 1;
                }
                const code = buf.charCodeAt(pos++);
                if (code === this.quote) this.token = Token.None;
                else if (code === CharCode.BACKSLASH) this.token = Token.Escape;
                else {
                    this.error = pos;
                    return pos;
                }
                continue;
            }
            if (this.token === Token.Escape) {
                const code = buf.charCodeAt(pos++);
                if (code === 120 || code === 117) {
                    this.missing = code === 120 ? 2 : 4;
                    this.token = Token.Hex;
                } else if (code === 13) this.token = Token.SkipLF;
                else if (code >= 49 && code <= CharCode.NINE) {
                    this.error = pos;
                    return pos;
                } else this.token = code === CharCode.ZERO ? Token.Zero : Token.String;
                continue;
            }
            if (this.token === Token.Hex) {
                while (pos < len && this.missing) {
                    if (hexDigit(buf.charCodeAt(pos)) < 0) {
                        this.error = pos;
                        return pos;
                    }
                    ++pos;
                    --this.missing;
                }
                if (!this.missing) this.token = Token.String;
                continue;
            }
            if (this.token === Token.Zero || this.token === Token.SkipLF) {
                const code = buf.charCodeAt(pos);
                if (this.token === Token.Zero && code >= CharCode.ZERO && code <= CharCode.NINE) {
                    this.error = pos;
                    return pos;
                }
                if (this.token === Token.SkipLF && code === 10) ++pos;
                this.token = Token.String;
                continue;
            }
            if (this.token === Token.Identifier || this.token === Token.Scalar) {
                const start = pos;
                TOKEN_END.lastIndex = pos;
                if (!TOKEN_END.test(buf)) {
                    this.acc += buf.slice(pos);
                    return len;
                }
                pos = TOKEN_END.lastIndex - 1;
                this.acc += buf.slice(start, pos);
                const valid =
                    this.token === Token.Identifier
                        ? decodeIdentifier(this.acc) !== undefined
                        : this.acc === 'true' ||
                          this.acc === 'false' ||
                          this.acc === 'null' ||
                          NUMBER.test(this.acc);
                if (!valid) {
                    this.error = pos;
                    return pos;
                }
                this.acc = '';
                this.token = Token.None;
                continue;
            }
            if (this.comment) {
                const code = buf.charCodeAt(pos++);
                if (this.comment === 1) {
                    if (code === 47) this.comment = 2;
                    else if (code === 42) this.comment = 3;
                    else {
                        this.error = pos;
                        return pos;
                    }
                } else if (this.comment === 2) {
                    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029)
                        this.comment = 0;
                } else if (this.comment === 3) {
                    if (code === 42) this.comment = 4;
                } else {
                    if (code === 47) this.comment = 0;
                    else if (code !== 42) this.comment = 3;
                }
                continue;
            }
            const code = buf.charCodeAt(pos);
            if (code < 128 ? code === 32 || (code >= 9 && code <= 13) : SPACE.test(buf[pos]!)) {
                ++pos;
                continue;
            }
            if (code === 47) {
                this.comment = 1;
                ++pos;
                continue;
            }
            const top = this.stack.length - 1,
                expect = this.stack[top]!;
            if (expect === Expect.Colon) {
                if (code !== CharCode.COLON) {
                    this.error = pos;
                    return pos;
                }
                this.stack[top] = Expect.ObjectValue;
                ++pos;
                continue;
            }
            if (expect === Expect.ArrayNext || expect === Expect.ObjectNext) {
                const array = expect === Expect.ArrayNext;
                if (code === CharCode.COMMA) {
                    this.stack[top] = array ? Expect.ArrayValue : Expect.ObjectKey;
                    ++pos;
                    continue;
                }
                if (code !== (array ? CharCode.RBRACKET : CharCode.RBRACE)) {
                    this.error = pos;
                    return pos;
                }
                ++pos;
                this.stack.pop();
                if (!this.stack.length) {
                    this.done = true;
                    return pos;
                }
                continue;
            }
            if (expect === Expect.ObjectKey) {
                if (code === CharCode.RBRACE) {
                    ++pos;
                    this.stack.pop();
                    if (!this.stack.length) {
                        this.done = true;
                        return pos;
                    }
                    continue;
                }
                this.stack[top] = Expect.Colon;
                if (code === CharCode.QUOTE || code === CharCode.SINGLE_QUOTE) {
                    this.quote = code;
                    this.token = Token.String;
                    ++pos;
                } else this.token = Token.Identifier;
                continue;
            }
            if (expect === Expect.ArrayValue && code === CharCode.RBRACKET) {
                ++pos;
                this.stack.pop();
                if (!this.stack.length) {
                    this.done = true;
                    return pos;
                }
                continue;
            }
            this.stack[top] = expect === Expect.ObjectValue ? Expect.ObjectNext : Expect.ArrayNext;
            if (code === CharCode.LBRACE || code === CharCode.LBRACKET) {
                if (this.stack.length >= this.limit) {
                    this.depthExceeded = true;
                    this.error = pos;
                    return pos;
                }
                this.stack.push(code === CharCode.LBRACKET ? Expect.ArrayValue : Expect.ObjectKey);
                ++pos;
            } else if (code === CharCode.QUOTE || code === CharCode.SINGLE_QUOTE) {
                this.quote = code;
                this.token = Token.String;
                ++pos;
            } else this.token = Token.Scalar;
        }
        return pos;
    }
}
