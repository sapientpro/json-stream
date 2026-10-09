import { CharCode } from './char-code.js';
import { ParserCore } from './core.js';
import { EMPTY_CONTEXT, stepContext } from './selectors.js';
import { State } from './state.js';
import { unicodeUnit, hexDigit, readHex4, readLiteral, isSpace, decodeIdentifier } from './lexical.js';
const IDENT = 14, SKIP_LF = 15;
const JSON5_TOKEN_END = /[\t\n\v\f\r \u00a0\ufeff\u2028\u2029\p{Zs},:{}\[\]\/]/gu;
const JSON5_SPACE = /[\t\n\v\f\r \u00a0\ufeff\u2028\u2029\p{Zs}]/u;
const JSON5_NUMBER = /^[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$/;
const JSON5_DOUBLE_END = /["\\\r\n]/g;
const JSON5_SINGLE_END = /['\\\r\n]/g;
/** JSON5 frontend; separate from the plain JSON hot loop. */
export class Json5Scanner extends ParserCore {
    protected _quote = CharCode.QUOTE;
    protected _comment = 0;
    protected _hexLength = 4;
    protected _resetScanner(): void { this._quote = CharCode.QUOTE; this._comment = 0; this._hexLength = 4; }
    protected _validateEnd(): boolean {
        // Release the token scanner's last RegExp subject after the document.
        JSON5_TOKEN_END.lastIndex = 0;
        JSON5_TOKEN_END.test(' ');
        return this._comment === 0;
    }
    protected _release(): void {
        // Cancellation and syntax errors may never reach end validation.
        if (!this._documentDone) this._validateEnd();
        // A super method adds a class context to every scanner method on V8.
        (ParserCore.prototype as Json5Scanner)._release.call(this);
    }
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
            const frame = this._stack[this._stack.length - 1]!;
            frame.key = name!;
            if (frame.context !== EMPTY_CONTEXT)
                this._path.push(name!);
            this._state = State.COLON;
        }
        else if (text === 'true' || text === 'false' || text === 'null') {
            this._emit(text === 'true' ? true : text === 'false' ? false : null);
        }
        else {
            if (!JSON5_NUMBER.test(text))
                this._failAt(pos);
            if (!this._context.hasValues && this._stack[this._stack.length - 1]?.container === undefined) {
                this._emit(undefined);
                return;
            }
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
    protected _readObjectKey(buf: string, pos: number, len: number): number {
        const quote = this._quote, limit = Math.min(len, pos + 16);
        let end = pos;
        while (end < limit) {
            const code = buf.charCodeAt(end);
            if (code === quote || code === CharCode.BACKSLASH || code === 13 || code === 10) break;
            ++end;
        }
        if (end === limit && end < len) {
            const pattern = quote === CharCode.QUOTE ? JSON5_DOUBLE_END : JSON5_SINGLE_END;
            pattern.lastIndex = end;
            const match = pattern.exec(buf);
            end = match ? match.index : len;
        }
        if (end < len && buf.charCodeAt(end) === quote) {
            const key = this._retainString ? this._flatten(buf.slice(pos, end)) : undefined;
            const frame = this._stack[this._stack.length - 1]!;
            frame.key = key!;
            if (frame.context !== EMPTY_CONTEXT) this._path.push(key!);
            this._pos = end + 1;
            this._state = State.COLON;
            return end + 1;
        }
        if (this._retainString) this._str += buf.slice(pos, end);
        this._state = State.STR;
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
                    if (code === quote || code === CharCode.BACKSLASH || code === 13 || code === 10)
                        break;
                    ++end;
                }
                if (end === limit && end < len) {
                    const pattern = quote === CharCode.QUOTE ? JSON5_DOUBLE_END : JSON5_SINGLE_END;
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
                    continue;
                }
                if (code !== CharCode.BACKSLASH)
                    this._failAt(pos);
                // Continue into ESC in this iteration, including JSON5-only escapes.
                this._state = State.ESC;
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
                if (code >= 49 && code <= CharCode.NINE || ch === '0' && /[0-9]/.test(buf[pos] ?? ''))
                    this._failAt(pos);
                if (this._retainString || this._strSinks.length)
                    this._str += ch === '0' ? '\0' : ch === 'v' ? '\v' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch === 'b' ? '\b' : ch === 'f' ? '\f' : ch;
                this._state = State.STR;
                continue;
            }
            if (this._state === State.UESC) {
                const missing = this._hexLength - this._acc.length;
                let text: string, at: number;
                if (missing === this._hexLength && pos + missing <= len) {
                    text = buf;
                    at = pos;
                    pos += missing;
                }
                else {
                    const take = Math.min(missing, len - pos);
                    this._acc += buf.slice(pos, pos + take);
                    pos += take;
                    if (this._acc.length < this._hexLength)
                        break;
                    text = this._acc;
                    at = 0;
                }
                let value: number;
                if (this._hexLength === 4) value = readHex4(text, at);
                else {
                    const a = hexDigit(text.charCodeAt(at)), b = hexDigit(text.charCodeAt(at + 1));
                    value = (a | b) < 0 ? -1 : (a << 4) | b;
                }
                if (value < 0)
                    this._failAt(pos);
                if (this._retainString || this._strSinks.length)
                    this._str += unicodeUnit(value);
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
                    if (code === CharCode.LBRACE || code === CharCode.LBRACKET) {
                        ++pos;
                        this._open(code === CharCode.LBRACKET);
                    }
                    else if (code === CharCode.RBRACKET && this._stack.at(-1)?.isArray) {
                        ++pos;
                        this._close();
                    }
                    else if (code === CharCode.QUOTE || code === CharCode.SINGLE_QUOTE) {
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
                        if ((code >= CharCode.ZERO && code <= CharCode.NINE) || code === CharCode.MINUS || code === CharCode.PLUS) {
                            const negative = code === CharCode.MINUS;
                            const start = pos + (code === CharCode.MINUS || code === CharCode.PLUS ? 1 : 0);
                            let finish = start, digits = 0, integer = 0;
                            while (finish < len && digits < 8) {
                                const digit = buf.charCodeAt(finish);
                                if (digit < CharCode.ZERO || digit > CharCode.NINE)
                                    break;
                                integer = integer * 10 + digit - CharCode.ZERO;
                                ++finish;
                                ++digits;
                            }
                            const next = buf.charCodeAt(finish);
                            const terminal = next === CharCode.COMMA || next === CharCode.RBRACE || next === CharCode.RBRACKET || next === 47 || isSpace(next) || next === 11 || next === 12 || next >= 128 && JSON5_SPACE.test(buf[finish]!);
                            if (digits && (digits === 1 || buf.charCodeAt(start) !== CharCode.ZERO) && terminal) {
                                pos = finish;
                                this._pos = pos;
                                this._emit(negative ? -integer : integer);
                                break;
                            }
                        }
                        else if (code === 116 || code === 102 || code === 110) {
                            const literal = readLiteral(buf, pos, len);
                            if (literal) {
                                const end = pos + (literal === 2 ? 5 : 4), next = buf.charCodeAt(end);
                                const terminal = next === CharCode.COMMA || next === CharCode.RBRACE || next === CharCode.RBRACKET ||
                                    next === CharCode.COLON || next === CharCode.LBRACE || next === CharCode.LBRACKET || next === 47 ||
                                    isSpace(next) || next === 11 || next === 12 || next >= 128 && JSON5_SPACE.test(buf[end]!);
                                if (terminal) {
                                    pos = end;
                                    this._pos = pos;
                                    this._emit(literal === 1 ? true : literal === 2 ? false : null);
                                    break;
                                }
                            }
                        }
                        this._acc = '';
                        this._state = State.NUM;
                    }
                    break;
                case State.OBJ_FIRST:
                case State.OBJ_KEY:
                    if (code === CharCode.RBRACE) {
                        ++pos;
                        this._close();
                    }
                    else if (code === CharCode.QUOTE || code === CharCode.SINGLE_QUOTE) {
                        ++pos;
                        this._quote = code;
                        this._keyMode = true;
                        this._retainString = this._needsKey();
                        if (this._hasChunks) this._state = State.STR;
                        else pos = this._readObjectKey(buf, pos, len);
                    }
                    else {
                        this._acc = '';
                        this._state = IDENT;
                    }
                    break;
                case State.COLON:
                    if (code !== CharCode.COLON)
                        this._failAt(pos);
                    ++pos;
                    this._state = State.VALUE;
                    break;
                case State.OBJ_NEXT:
                    if (code === CharCode.RBRACE) {
                        ++pos;
                        this._close();
                    }
                    else if (code === CharCode.COMMA) {
                        ++pos;
                        this._state = State.OBJ_KEY;
                    }
                    else
                        this._failAt(pos);
                    break;
                case State.ARR_NEXT:
                    if (code === CharCode.RBRACKET) {
                        ++pos;
                        this._close();
                    }
                    else if (code === CharCode.COMMA) {
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
