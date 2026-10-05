import { ParserCore } from './core.js';
import { stepContext } from './selectors.js';
import { VALUE, OBJ_FIRST, OBJ_KEY, COLON, OBJ_NEXT, ARR_NEXT, STR, ESC, UESC, NUM, LIT, END, FAILED } from './state.js';
import { IS_V8, unicodeUnit, readHex4, readLiteral, isSpace } from './lexical.js';
const QUOTE = 34, BACKSLASH = 92, LBRACE = 123, RBRACE = 125, LBRACKET = 91, RBRACKET = 93, COMMA = 44, COLON_CH = 58, MINUS = 45, PLUS = 43, DOT = 46, ZERO = 48, NINE = 57, LOWER_E = 101, UPPER_E = 69;
// Use the native scanner only after a short prefix; tiny strings need no match allocation.
const IS_BUN = typeof (globalThis as {
    Bun?: unknown;
}).Bun !== 'undefined';
const STRING_END = IS_V8 ? /["\\]/g : /["\\\u0000-\u001f]/g;
const STRING_CONTROL = /[\u0000-\u001f]/u;
// Native serialization validates only bounded, raw segments; it never parses a document.
// Lone UTF-16 surrogates also need escaping, so length mismatches fall back to the control check.
const hasStringControl = (part: string, pos: number, end: number, len: number): boolean => {
    if (pos === 0 && end === len && part.charCodeAt(0) < 128 && part.length >= 8192 && part.length <= 65536 &&
        JSON.stringify(part).length === part.length + 2) return false;
    return STRING_CONTROL.test(part);
};
const ESCAPES: {
    [key: string]: string;
} = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const HEX4 = /^[0-9a-fA-F]{4}$/;
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
// Keep the string scanner outside the state-machine loop.
const scanStringEnd = (buf: string, pos: number, len: number): number => {
    let end = pos;
    const scanEnd = Math.min(len, pos + 32);
    while (end < scanEnd) {
        const code = buf.charCodeAt(end);
        if (code === QUOTE || code === BACKSLASH || code < 32)
            return end;
        ++end;
    }
    if (end < len) {
        STRING_END.lastIndex = end;
        // Each match is one code unit, so lastIndex points just past the delimiter.
        return STRING_END.test(buf) ? STRING_END.lastIndex - 1 : len;
    }
    return end;
};
// Batch complete escapes within one input chunk; boundary/cut handling remains in STR.
const readEscapedRun = (buf: string, pos: number, len: number, retain: boolean): {pos: number; text: string} => {
    let text = '';
    while (pos < len) {
        const code = buf.charCodeAt(pos);
        if (code < 32 || code === QUOTE) break;
        if (code === BACKSLASH) {
            const ch = buf[pos + 1];
            if (ch === 'u') {
                if (pos + 6 > len) break;
                const value = readHex4(buf, pos + 2);
                if (value < 0) break;
                if (retain) text += unicodeUnit(value);
                pos += 6;
            }
            else {
                const escaped = ch === undefined ? undefined : ESCAPES[ch];
                if (escaped === undefined) break;
                if (retain) text += escaped;
                pos += 2;
            }
        }
        else {
            const end = scanStringEnd(buf, pos, len);
            if (end === pos) break;
            const part = buf.slice(pos, end);
            if (IS_V8 && end - pos > 32 && hasStringControl(part, pos, end, len)) break;
            if (retain) text += part;
            pos = end;
        }
    }
    return {pos, text};
};
export class JsonScanner extends ParserCore {
    protected _numPhase = 0;
    protected _resetScanner(): void { this._numPhase = 0; }
    protected _finishInput(): void { if (this._state === NUM)
        this._closeNumber();
    else if (this._state === LIT)
        this._closeLiteral(); }
    protected _closeNumber(): void {
        const text = this._acc;
        this._acc = '';
        const phase = this._numPhase;
        this._numPhase = 0;
        if (!JSON_NUMBER.test(text))
            this._fail(this._syntaxError());
        this._emit(Number(text));
    }
    protected _closeLiteral(): void {
        const text = this._acc;
        this._acc = '';
        if (text === 'true')
            this._emit(true);
        else if (text === 'false')
            this._emit(false);
        else if (text === 'null')
            this._emit(null);
        else
            this._fail(this._syntaxError());
    }
    protected _run(): void {
        const buf = this._buf;
        const len = buf.length;
        let pos = this._pos;
        for (;;) {
            if (this._done)
                return;
            switch (this._state) {
                case END:
                    if (this._framed) { this._pos = pos; return; }
                    while (pos < len && isSpace(buf.charCodeAt(pos)))
                        ++pos;
                    this._pos = pos;
                    if (pos < len)
                        this._fail(this._syntaxError());
                    return;
                case FAILED:
                    this._pos = pos;
                    return;
                case VALUE:
                case OBJ_FIRST:
                case OBJ_KEY:
                case COLON:
                case OBJ_NEXT:
                case ARR_NEXT: {
                    while (pos < len && isSpace(buf.charCodeAt(pos)))
                        ++pos;
                    if (pos >= len) {
                        this._pos = pos;
                        return;
                    }
                    const code = buf.charCodeAt(pos);
                    switch (this._state) {
                        case VALUE:
                            if (this._tracking)
                                this._context = this._stack.length ? this._stack[this._stack.length - 1]!.arrayContext ?? stepContext(this._stack[this._stack.length - 1]!.context, this._path[this._path.length - 1]!) : this._rootContext;
                            if (code === LBRACE) {
                                ++pos;
                                this._open(false);
                            }
                            else if (code === LBRACKET) {
                                ++pos;
                                this._open(true);
                            }
                            else if (code === RBRACKET && this._stack[this._stack.length - 1]?.isArray && this._stack[this._stack.length - 1]!.count === 0) {
                                ++pos;
                                this._close();
                            }
                            else if (code === QUOTE) {
                                ++pos;
                                this._keyMode = false;
                                this._retainString = this._shouldRetain();
                                if (this._hasChunks)
                                    this._findChunkSinks(this._root, 0);
                                this._state = STR;
                            }
                            else if ((code >= ZERO && code <= NINE) || code === MINUS) {
                                const start = pos, negative = code === MINUS;
                                let finish = pos + (negative ? 1 : 0), digits = 0, integer = 0;
                                while (finish < len && digits < 8) {
                                    const digit = buf.charCodeAt(finish);
                                    if (digit < ZERO || digit > NINE)
                                        break;
                                    integer = integer * 10 + digit - ZERO;
                                    ++finish;
                                    ++digits;
                                }
                                let next = buf.charCodeAt(finish);
                                if (digits && (digits === 1 || buf.charCodeAt(start + (negative ? 1 : 0)) !== ZERO) && finish < len && (next === COMMA || next === RBRACE || next === RBRACKET || isSpace(next))) {
                                    pos = finish;
                                    this._pos = pos;
                                    this._acc = '';
                                    this._emit(negative ? -integer : integer);
                                    break;
                                }
                                // Grammar transitions occur between runs, never on each digit.
                                while (finish < len) {
                                    const digit = buf.charCodeAt(finish);
                                    if (digit < ZERO || digit > NINE)
                                        break;
                                    ++finish;
                                    ++digits;
                                }
                                let valid = digits > 0 && (digits === 1 || buf.charCodeAt(start + (negative ? 1 : 0)) !== ZERO);
                                let phase = valid ? 1 : 0;
                                next = buf.charCodeAt(finish);
                                if (valid && next === DOT) {
                                    const fractionStart = ++finish;
                                    phase = 2;
                                    while (finish < len) {
                                        const digit = buf.charCodeAt(finish);
                                        if (digit < ZERO || digit > NINE)
                                            break;
                                        ++finish;
                                    }
                                    valid = finish > fractionStart;
                                    if (valid)
                                        phase = 3;
                                    next = buf.charCodeAt(finish);
                                }
                                if (valid && (next === LOWER_E || next === UPPER_E)) {
                                    ++finish;
                                    phase = 4;
                                    const sign = buf.charCodeAt(finish);
                                    if (sign === PLUS || sign === MINUS) {
                                        ++finish;
                                        phase = 5;
                                    }
                                    const exponentStart = finish;
                                    while (finish < len) {
                                        const digit = buf.charCodeAt(finish);
                                        if (digit < ZERO || digit > NINE)
                                            break;
                                        ++finish;
                                    }
                                    valid = finish > exponentStart;
                                    if (valid)
                                        phase = 6;
                                    next = buf.charCodeAt(finish);
                                }
                                if (valid && finish < len && (next === COMMA || next === RBRACE || next === RBRACKET || isSpace(next))) {
                                    pos = finish;
                                    this._pos = pos;
                                    this._acc = '';
                                    this._emit(Number(buf.slice(start, finish)));
                                    break;
                                }
                                this._acc = buf.slice(start, finish);
                                this._numPhase = phase;
                                pos = finish;
                                this._state = NUM;
                            }
                            else {
                                this._acc = '';
                                const literal = pos + 4 < len ? readLiteral(buf, pos, len) : 0;
                                if (literal) {
                                    pos += literal === 2 ? 5 : 4;
                                    this._pos = pos;
                                    this._emit(literal === 1 ? true : literal === 2 ? false : null);
                                }
                                else {
                                    this._state = LIT;
                                }
                            }
                            break;
                        case OBJ_FIRST:
                        case OBJ_KEY:
                            // a trailing comma leaves OBJ_KEY facing the closing brace
                            if (code === RBRACE && this._state === OBJ_FIRST) {
                                ++pos;
                                this._close();
                                break;
                            }
                            if (code !== QUOTE) {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            ++pos;
                            this._keyMode = true;
                            this._retainString = this._needsKey();
                            this._state = STR;
                            break;
                        case COLON:
                            if (code !== COLON_CH) {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            ++pos;
                            this._state = VALUE;
                            break;
                        case OBJ_NEXT:
                            if (code === RBRACE) {
                                ++pos;
                                this._close();
                            }
                            else if (code === COMMA) {
                                ++pos;
                                this._state = OBJ_KEY;
                            }
                            else {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            break;
                        case ARR_NEXT:
                            if (code === RBRACKET) {
                                ++pos;
                                this._close();
                            }
                            else if (code === COMMA) {
                                ++pos;
                                this._state = VALUE;
                            }
                            else {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            break;
                    }
                    break;
                }
                case STR: {
                    const end = scanStringEnd(buf, pos, len);
                    if (end > pos) {
                        const part = buf.slice(pos, end);
                        if (IS_V8 && end - pos > 32 && hasStringControl(part, pos, end, len)) {
                            this._pos = pos;
                            this._fail(this._syntaxError());
                        }
                        if (this._retainString || this._strSinks.length)
                            this._str += part;
                        pos = end;
                    }
                    if (pos >= len) {
                        this._flushChunk();
                        this._pos = pos;
                        return;
                    }
                    if (buf.charCodeAt(pos) < 32) {
                        this._pos = pos;
                        this._fail(this._syntaxError());
                    }
                    if (buf.charCodeAt(pos) === QUOTE) {
                        ++pos;
                        this._pos = pos;
                        this._closeString();
                    }
                    else {
                        if (IS_V8 && this._str.length >= 64 && len - pos >= 256) {
                            const run = readEscapedRun(buf, pos, len, this._retainString || this._strSinks.length > 0);
                            if (run.pos > pos) {
                                if (run.text) this._str += run.text;
                                pos = run.pos;
                                break;
                            }
                        }
                        // Decode complete escapes without a second state-machine dispatch.
                        const ch = buf[pos + 1];
                        if (ch === 'u' && pos + 6 <= len) {
                            const value = readHex4(buf, pos + 2);
                            if (value < 0) {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            if (this._retainString || this._strSinks.length)
                                this._str += unicodeUnit(value);
                            pos += 6;
                        }
                        else if (ch !== undefined && ch !== 'u') {
                            const value = ESCAPES[ch];
                            if (value === undefined) {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            if (this._retainString || this._strSinks.length)
                                this._str += value;
                            pos += 2;
                        }
                        else {
                            ++pos;
                            this._state = ESC;
                        }
                    }
                    break;
                }
                case ESC: {
                    if (pos >= len) {
                        this._flushChunk();
                        this._pos = pos;
                        return;
                    }
                    const ch = buf[pos]!;
                    if (ch === 'u') {
                        if (pos + 5 <= len) {
                            const value = readHex4(buf, pos + 1);
                            pos += 5;
                            if (value < 0) {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            if (this._retainString || this._strSinks.length)
                                this._str += unicodeUnit(value);
                            this._state = STR;
                            break;
                        }
                        ++pos;
                        this._acc = '';
                        this._state = UESC;
                        break;
                    }
                    if (!'"\\/bfnrt'.includes(ch)) {
                        this._pos = pos;
                        this._fail(this._syntaxError());
                    }
                    if (this._retainString || this._strSinks.length) {
                        this._str += ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r'
                            : ch === 'b' ? '\b' : ch === 'f' ? '\f' : ch;
                    }
                    ++pos;
                    this._state = STR;
                    break;
                }
                case UESC: {
                    const take = Math.min(4 - this._acc.length, len - pos);
                    this._acc += buf.slice(pos, pos + take);
                    pos += take;
                    if (this._acc.length < 4) {
                        this._flushChunk();
                        this._pos = pos;
                        return;
                    }
                    if (!HEX4.test(this._acc)) {
                        this._pos = pos;
                        this._fail(this._syntaxError());
                    }
                    if (this._retainString || this._strSinks.length) {
                        this._str += unicodeUnit(parseInt(this._acc, 16));
                    }
                    this._acc = '';
                    this._state = STR;
                    break;
                }
                case NUM: {
                    let end = pos, phase = this._numPhase;
                    while (end < len) {
                        const code = buf.charCodeAt(end);
                        if (phase !== 7 && code >= ZERO && code <= NINE) {
                            // One grammar transition per digit run, not per digit.
                            if (phase === 0)
                                phase = 1;
                            else if (phase === 2)
                                phase = 3;
                            else if (phase === 4 || phase === 5)
                                phase = 6;
                            do {
                                ++end;
                                if (end >= len)
                                    break;
                                const digit = buf.charCodeAt(end);
                                if (digit < ZERO || digit > NINE)
                                    break;
                            } while (true);
                            continue;
                        }
                        if (phase === 1 && code === DOT)
                            phase = 2;
                        else if ((phase === 1 || phase === 3) && (code === LOWER_E || code === UPPER_E))
                            phase = 4;
                        else if (phase === 4 && (code === PLUS || code === MINUS))
                            phase = 5;
                        else if (code === MINUS || code === PLUS || code === DOT || code === LOWER_E || code === UPPER_E || (code >= ZERO && code <= NINE))
                            phase = 7;
                        else
                            break;
                        ++end;
                    }
                    this._numPhase = phase;
                    if (end > pos) {
                        this._acc += buf.slice(pos, end);
                        pos = end;
                    }
                    this._pos = pos;
                    if (pos >= len)
                        return;
                    this._closeNumber();
                    break;
                }
                case LIT: {
                    let end = pos;
                    while (end < len && buf.charCodeAt(end) >= 97 && buf.charCodeAt(end) <= 122)
                        ++end;
                    if (end > pos) {
                        this._acc += buf.slice(pos, end);
                        pos = end;
                    }
                    if (pos >= len) {
                        this._pos = pos;
                        return;
                    }
                    this._pos = pos;
                    this._closeLiteral();
                    break;
                }
            }
        }
    }
}
