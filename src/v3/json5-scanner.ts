import { ParserCore } from './core.js';
import { stepContext } from './selectors.js';
import { State } from './state.js';
import { unicodeUnit, hexDigit, readHex4, isSpace, decodeIdentifier } from './lexical.js';
const IDENT = 14, SKIP_LF = 15;
const JSON5_TOKEN_END = /[\t\n\v\f\r \u00a0\ufeff\u2028\u2029\p{Zs},:{}\[\]\/]/gu;
const JSON5_SPACE = /[\t\n\v\f\r \u00a0\ufeff\u2028\u2029\p{Zs}]/u;
const JSON5_NUMBER = /^[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$/;
const JSON5_DOUBLE_END = /["\\\r\n]/g;
const JSON5_SINGLE_END = /['\\\r\n]/g;
const QUOTE = 34, BACKSLASH = 92, LBRACE = 123, RBRACE = 125, LBRACKET = 91, RBRACKET = 93, COMMA = 44, COLON_CH = 58, MINUS = 45, PLUS = 43, DOT = 46, ZERO = 48, NINE = 57, LOWER_E = 101, UPPER_E = 69;
/** JSON5 frontend; separate from the plain JSON hot loop. */
export class Json5Scanner extends ParserCore {
    protected _quote = 34;
    protected _comment = 0;
    protected _hexLength = 4;
    protected _resetScanner(): void { this._quote = 34; this._comment = 0; this._hexLength = 4; }
    protected _validateEnd(): boolean { return this._comment === 0; }
    protected _failAt(pos: number): never {
        this._pos = pos;
        this._fail(this._syntaxError());
        throw this._syntaxError();
    }
    protected _finishToken(pos: number): void {
        const text = this._acc;
        this._acc = '';
        if (this._state === IDENT) {
            const name = decodeIdentifier(text);
            if (name === undefined)
                this._failAt(pos);
            this._stack[this._stack.length - 1]!.key = name!;
            if (this._tracking)
                this._path.push(name!);
            this._state = State.COLON;
        }
        else if (text === 'true' || text === 'false' || text === 'null') {
            this._emit(text === 'true' ? true : text === 'false' ? false : null);
        }
        else {
            if (!JSON5_NUMBER.test(text))
                this._failAt(pos);
            const negative = text[0] === '-', unsigned = text[0] === '-' || text[0] === '+' ? text.slice(1) : text;
            this._emit(negative ? -Number(unsigned) : Number(unsigned));
        }
    }
    protected _tokenEnd(buf: string, pos: number, len: number): number {
        JSON5_TOKEN_END.lastIndex = pos;
        if (!JSON5_TOKEN_END.test(buf)) return len;
        let end = JSON5_TOKEN_END.lastIndex - 1;
        const last = buf.charCodeAt(end);
        // A Unicode whitespace match may occupy a surrogate pair.
        if (last >= 0xDC00 && last <= 0xDFFF) --end;
        return end;
    }
    protected _run(): void {
        const buf = this._buf, len = buf.length;
        let pos = this._pos;
        for (;;) {
            if (this._framed && this._state === State.END) break;
            if (this._state === State.FAILED || this._done)
                break;
            if (this._state === SKIP_LF) {
                if (pos === len && !this._eof)
                    break;
                if (buf.charCodeAt(pos) === 10)
                    ++pos;
                this._state = State.STR;
                continue;
            }
            if (this._state === State.NUM || this._state === IDENT) {
                const start = pos;
                pos = this._tokenEnd(buf, pos, len);
                this._acc += buf.slice(start, pos);
                if (pos === len && !this._eof)
                    break;
                this._finishToken(pos);
                continue;
            }
            if (this._state === State.STR) {
                if (pos === len)
                    break;
                let end = pos;
                const limit = Math.min(len, pos + 16), quote = this._quote;
                while (end < limit) {
                    const code = buf.charCodeAt(end);
                    if (code === quote || code === 92 || code === 13 || code === 10)
                        break;
                    ++end;
                }
                if (end === limit && end < len) {
                    const pattern = quote === 34 ? JSON5_DOUBLE_END : JSON5_SINGLE_END;
                    pattern.lastIndex = end;
                    const match = pattern.exec(buf);
                    end = match ? match.index : len;
                }
                if (this._retainString || this._strSinks.length)
                    this._str += buf.slice(pos, end);
                pos = end;
                if (pos === len)
                    break;
                const code = buf.charCodeAt(pos++);
                if (code === this._quote) {
                    this._pos = pos;
                    this._closeString();
                }
                else if (code === 92)
                    this._state = State.ESC;
                else
                    this._failAt(pos);
                continue;
            }
            if (this._state === State.ESC) {
                if (pos === len)
                    break;
                const ch = buf[pos]!, code = buf.charCodeAt(pos);
                if (ch === '0' && pos + 1 === len && !this._eof)
                    break;
                ++pos;
                if (ch === 'x' || ch === 'u') {
                    const length = ch === 'x' ? 2 : 4;
                    if (pos + length <= len) {
                        let value: number;
                        if (length === 4)
                            value = readHex4(buf, pos);
                        else {
                            const a = hexDigit(buf.charCodeAt(pos)), b = hexDigit(buf.charCodeAt(pos + 1));
                            value = (a | b) < 0 ? -1 : (a << 4) | b;
                        }
                        if (value < 0)
                            this._failAt(pos);
                        if (this._retainString || this._strSinks.length)
                            this._str += unicodeUnit(value);
                        pos += length;
                        this._state = State.STR;
                        continue;
                    }
                    this._acc = '';
                    this._hexLength = length;
                    this._state = State.UESC;
                    continue;
                }
                if (code === 13) {
                    this._state = SKIP_LF;
                    continue;
                }
                if (code === 10 || code === 0x2028 || code === 0x2029) {
                    this._state = State.STR;
                    continue;
                }
                if (code >= 49 && code <= 57 || ch === '0' && /[0-9]/.test(buf[pos] ?? ''))
                    this._failAt(pos);
                if (this._retainString || this._strSinks.length)
                    this._str += ch === '0' ? '\0' : ch === 'v' ? '\v' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch === 'b' ? '\b' : ch === 'f' ? '\f' : ch;
                this._state = State.STR;
                continue;
            }
            if (this._state === State.UESC) {
                while (pos < len && this._acc.length < this._hexLength) {
                    const ch = buf[pos++]!;
                    if (hexDigit(ch.charCodeAt(0)) < 0)
                        this._failAt(pos);
                    this._acc += ch;
                }
                if (this._acc.length < this._hexLength)
                    break;
                if (this._retainString || this._strSinks.length)
                    this._str += unicodeUnit(parseInt(this._acc, 16));
                this._acc = '';
                this._state = State.STR;
                continue;
            }
            // Comments and whitespace occur only between grammar tokens.
            if (this._comment) {
                if (pos === len)
                    break;
                const code = buf.charCodeAt(pos++);
                if (this._comment === 1) {
                    if (code === 47)
                        this._comment = 2;
                    else if (code === 42)
                        this._comment = 3;
                    else
                        this._failAt(pos);
                }
                else if (this._comment === 2) {
                    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029)
                        this._comment = 0;
                }
                else if (this._comment === 3) {
                    if (code === 42)
                        this._comment = 4;
                }
                else {
                    if (code === 47)
                        this._comment = 0;
                    else if (code !== 42)
                        this._comment = 3;
                }
                continue;
            }
            if (pos === len)
                break;
            const ch = buf[pos]!, code = buf.charCodeAt(pos);
            if (code < 128 ? code === 32 || code >= 9 && code <= 13 : JSON5_SPACE.test(ch)) {
                ++pos;
                continue;
            }
            if (code === 47) {
                ++pos;
                this._comment = 1;
                continue;
            }
            switch (this._state) {
                case State.END:
                    this._failAt(pos);
                    break;
                case State.VALUE:
                    if (this._tracking)
                        this._context = this._stack.length ? this._stack[this._stack.length - 1]!.arrayContext ?? stepContext(this._stack[this._stack.length - 1]!.context, this._path[this._path.length - 1]!) : this._rootContext;
                    if (code === 123 || code === 91) {
                        ++pos;
                        this._open(code === 91);
                    }
                    else if (code === 93 && this._stack.at(-1)?.isArray) {
                        ++pos;
                        this._close();
                    }
                    else if (code === 34 || code === 39) {
                        ++pos;
                        this._quote = code;
                        this._keyMode = false;
                        this._retainString = this._shouldRetain();
                        if (this._hasChunks)
                            this._findChunkSinks(this._root, 0);
                        this._state = State.STR;
                    }
                    else {
                        // Short decimal integers need no token string, regex or Number().
                        if ((code >= 48 && code <= 57) || code === 45 || code === 43) {
                            const negative = code === 45;
                            const start = pos + (code === 45 || code === 43 ? 1 : 0);
                            let finish = start, digits = 0, integer = 0;
                            while (finish < len && digits < 8) {
                                const digit = buf.charCodeAt(finish);
                                if (digit < 48 || digit > 57)
                                    break;
                                integer = integer * 10 + digit - 48;
                                ++finish;
                                ++digits;
                            }
                            const next = buf.charCodeAt(finish);
                            const terminal = next === 44 || next === 125 || next === 93 || next === 47 || isSpace(next) || next === 11 || next === 12 || next >= 128 && JSON5_SPACE.test(buf[finish]!);
                            if (digits && (digits === 1 || buf.charCodeAt(start) !== 48) && terminal) {
                                pos = finish;
                                this._pos = pos;
                                this._emit(negative ? -integer : integer);
                                break;
                            }
                        }
                        this._acc = '';
                        this._state = State.NUM;
                    }
                    break;
                case State.OBJ_FIRST:
                case State.OBJ_KEY:
                    if (code === 125) {
                        ++pos;
                        this._close();
                    }
                    else if (code === 34 || code === 39) {
                        ++pos;
                        this._quote = code;
                        this._keyMode = true;
                        this._retainString = this._needsKey();
                        this._state = State.STR;
                    }
                    else {
                        this._acc = '';
                        this._state = IDENT;
                    }
                    break;
                case State.COLON:
                    if (code !== 58)
                        this._failAt(pos);
                    ++pos;
                    this._state = State.VALUE;
                    break;
                case State.OBJ_NEXT:
                    if (code === 125) {
                        ++pos;
                        this._close();
                    }
                    else if (code === 44) {
                        ++pos;
                        this._state = State.OBJ_KEY;
                    }
                    else
                        this._failAt(pos);
                    break;
                case State.ARR_NEXT:
                    if (code === 93) {
                        ++pos;
                        this._close();
                    }
                    else if (code === 44) {
                        ++pos;
                        this._state = State.VALUE;
                    }
                    else
                        this._failAt(pos);
                    break;
                default: this._failAt(pos);
            }
        }
        this._pos = pos;
        this._flushChunk();
        if (this._eof && this._comment === 2)
            this._comment = 0;
    }
}
