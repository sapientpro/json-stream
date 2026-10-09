import { CharCode } from './char-code.js';
import { JsonSubtreeValidator } from './skip-json.js';
import { ParserCore } from './core.js';
import { EMPTY_CONTEXT, stepContext } from './selectors.js';
import { State } from './state.js';
import { IS_V8, unicodeUnit, readHex4, readLiteral, isSpace } from './lexical.js';
// Use the native scanner only after a short prefix; tiny strings need no match allocation.
const STRING_END = IS_V8 ? /["\\]/g : /["\\\u0000-\u001f]/g;
const STRING_CONTROL = /[\u0000-\u001f]/u;
// Native serialization validates only bounded, raw segments; it never parses a document.
// Lone UTF-16 surrogates also need escaping, so length mismatches fall back to the control check.
const hasStringControl = (part: string, pos: number, end: number, len: number): boolean => {
    if (
        pos === 0 &&
        end === len &&
        part.charCodeAt(0) < 128 &&
        part.length >= 8192 &&
        part.length <= 65536 &&
        JSON.stringify(part).length === part.length + 2
    )
        return false;
    return STRING_CONTROL.test(part);
};
const ESCAPES: {
    [key: string]: string;
} = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
// Keep the string scanner outside the state-machine loop.
const scanStringEnd = (buf: string, pos: number, len: number): number => {
    let end = pos;
    const scanEnd = Math.min(len, pos + 32);
    while (end < scanEnd) {
        const code = buf.charCodeAt(end);
        if (code === CharCode.QUOTE || code === CharCode.BACKSLASH || code < 32) return end;
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
const readEscapedRun = (
    buf: string,
    pos: number,
    len: number,
    retain: boolean,
): { pos: number; text: string } => {
    if (retain) {
        let end = buf.indexOf('"', pos);
        while (end >= 0) {
            let before = end - 1;
            while (before >= pos && buf.charCodeAt(before) === CharCode.BACKSLASH) --before;
            if (((end - before - 1) & 1) === 0) break;
            end = buf.indexOf('"', end + 1);
        }
        if (end < 0) {
            end = len;
            const slash = buf.lastIndexOf('\\', end - 1);
            let before = slash - 1;
            while (before >= pos && buf.charCodeAt(before) === CharCode.BACKSLASH) --before;
            if ((slash - before) & 1) {
                const tail = end - slash;
                if (tail === 1 || (buf[slash + 1] === 'u' && tail < 6)) end = slash;
            }
        }
        if (end - pos >= 256) {
            try {
                return { pos: end, text: JSON.parse('"' + buf.slice(pos, end) + '"') };
            } catch {
                // Invalid fragments retain the ordinary decoder and error positions.
            }
        }
    }
    let text = '';
    while (pos < len) {
        const code = buf.charCodeAt(pos);
        if (code < 32 || code === CharCode.QUOTE) break;
        if (code === CharCode.BACKSLASH) {
            const ch = buf[pos + 1];
            if (ch === 'u') {
                if (pos + 6 > len) break;
                const value = readHex4(buf, pos + 2);
                if (value < 0) break;
                if (retain) text += unicodeUnit(value);
                pos += 6;
            } else {
                const escaped = ch === undefined ? undefined : ESCAPES[ch];
                if (escaped === undefined) break;
                if (retain) text += escaped;
                pos += 2;
            }
        } else {
            const end = scanStringEnd(buf, pos, len);
            if (end === pos) break;
            const part = buf.slice(pos, end);
            if (IS_V8 && end - pos > 32 && hasStringControl(part, pos, end, len)) break;
            if (retain) text += part;
            pos = end;
        }
    }
    return { pos, text };
};
export class JsonScanner extends ParserCore {
    declare protected _skip: JsonSubtreeValidator | undefined;
    protected _skipContainer(isArray: boolean): boolean {
        (this._skip ??= new JsonSubtreeValidator()).start(
            isArray,
            this._maxDepth - this._stack.length,
        );
        this._state = State.SKIP;
        return true;
    }
    protected _validateEnd(): boolean {
        // RegExp's last subject can keep a completed input buffer alive.
        this._skip?.release();
        STRING_END.lastIndex = 0;
        STRING_END.test('"');
        return true;
    }
    protected _release(): void {
        this._requiredLength = 0;
        // Errors and cancellation may skip document-end validation.
        if (!this._documentDone) this._validateEnd();
        // Avoid introducing a super home-object context in scanner hot methods.
        (ParserCore.prototype as JsonScanner)._release.call(this);
    }
    // Reuse bounded, validated keys; collisions always fall back to ordinary scanning.
    declare protected _keyCache: (string | undefined)[];
    declare protected _keyMisses: number;
    protected _numPhase = 0;
    // Zero waits for the escape kind; positive values count missing Unicode digits.
    private _requiredLength = 0;
    protected _resetScanner(): void {
        this._skip?.release();
        this._requiredLength = 0;
        this._numPhase = 0;
        if (this._keyCache) {
            this._readObjectKey = this._readObjectKeyCached;
            this._keyMisses = 0;
        }
    }
    protected _finishInput(): void {
        if (this._state === State.NUM) this._closeNumber();
        else if (this._state === State.LIT) this._closeLiteral();
    }
    protected _closeNumber(): void {
        const text = this._acc;
        this._acc = '';
        this._numPhase = 0;
        if (!JSON_NUMBER.test(text)) this._fail(this._syntaxError());
        if (IS_V8) this._emitNumber(text, 0, text.length);
        else this._emit(Number(text));
    }
    protected _closeLiteral(): void {
        const text = this._acc;
        this._acc = '';
        if (text === 'true') this._emit(true);
        else if (text === 'false') this._emit(false);
        else if (text === 'null') this._emit(null);
        else this._fail(this._syntaxError());
    }
    protected _readObjectKey(buf: string, pos: number, len: number): number {
        // Cache setup is not worthwhile for small input windows or discarded keys.
        if (!this._retainString || len < 256 || this._stack.length < 2)
            return this._readObjectKeyOrdinary(buf, pos, len);
        return this._initializeKeyReader(buf, pos, len);
    }
    protected _initializeKeyReader(buf: string, pos: number, len: number): number {
        const end = this._readObjectKeyOrdinary(buf, pos, len);
        if (this._state === State.COLON) {
            const frame = this._stack[this._stack.length - 1]!;
            let useful = frame.container !== undefined;
            if (!useful)
                for (const node of frame.context.nodes) {
                    if (node.any || node.rest || node.children[frame.key]) {
                        useful = true;
                        break;
                    }
                }
            if (useful) {
                this._keyCache = [];
                this._keyMisses = 0;
                this._readObjectKey = this._readObjectKeyCached;
            }
        }
        return end;
    }
    protected _readObjectKeyCached(buf: string, pos: number, len: number): number {
        // Outer object keys are usually distinct; keep their ordinary reader.
        if (!this._retainString || this._stack.length < 2)
            return this._readObjectKeyOrdinary(buf, pos, len);
        const slot = buf.charCodeAt(pos) & 63;
        const cached = this._keyCache[slot];
        const hit =
            cached !== undefined &&
            pos + cached.length < len &&
            buf.charCodeAt(pos + cached.length) === CharCode.QUOTE &&
            buf.startsWith(cached, pos);
        const end = hit ? pos + cached!.length : scanStringEnd(buf, pos, len);
        const part = hit ? cached! : buf.slice(pos, end);
        if (hit) this._keyMisses = 0;
        // Distinct keys use the original reader for the rest of this record.
        else if (++this._keyMisses === 16) this._readObjectKey = this._readObjectKeyOrdinary;
        if (IS_V8 && end - pos > 32 && hasStringControl(part, pos, end, len)) {
            this._pos = pos;
            this._fail(this._syntaxError());
        }
        if (end < len && buf.charCodeAt(end) === CharCode.QUOTE) {
            this._pos = end + 1;
            const key = this._retainString ? this._flatten(part) : undefined;
            if (!hit && key !== undefined && key.length <= 64)
                this._keyCache[slot] = key.length < 13 ? key : (' ' + key).slice(1);
            const frame = this._stack[this._stack.length - 1]!;
            frame.key = key!;
            if (frame.context !== EMPTY_CONTEXT) this._path.push(key!);
            this._state = State.COLON;
            return end + 1;
        }
        if (this._retainString) this._str += part;
        this._state = State.STR;
        return end;
    }
    protected _readObjectKeyOrdinary(buf: string, pos: number, len: number): number {
        const end = scanStringEnd(buf, pos, len);
        const part = buf.slice(pos, end);
        if (IS_V8 && end - pos > 32 && hasStringControl(part, pos, end, len)) {
            this._pos = pos;
            this._fail(this._syntaxError());
        }
        if (end < len && buf.charCodeAt(end) === CharCode.QUOTE) {
            this._pos = end + 1;
            const key = this._retainString ? this._flatten(part) : undefined;
            const frame = this._stack[this._stack.length - 1]!;
            frame.key = key!;
            if (frame.context !== EMPTY_CONTEXT) this._path.push(key!);
            this._state = State.COLON;
            return end + 1;
        }
        if (this._retainString) this._str += part;
        this._state = State.STR;
        return end;
    }
    private _skipInput(buf: string, pos: number, len: number): number {
        const skip = this._skip!;
        pos = skip.run(buf, pos, len);
        if (skip.error >= 0) {
            this._pos = skip.error;
            this._fail(
                skip.depthExceeded
                    ? new SyntaxError('Json nesting deeper than ' + this._maxDepth)
                    : this._syntaxError(),
            );
        }
        if (skip.done) this._emit(undefined);
        return pos;
    }
    /** Selected only while an ignored subtree spans input writes. */
    protected _runDiscard(): void {
        this._pos = this._skipInput(this._buf, this._pos, this._buf.length);
        if (this._state === State.SKIP || this.closed) return;
        this._run = JsonScanner.prototype._run;
        this._run();
    }
    protected _run(): void {
        const buf = this._buf;
        const len = buf.length;
        let pos = this._pos;
        for (;;) {
            if (this._done) return;
            // Keep streamed string runs outside the numeric switch dispatch.
            if (this._state === State.STR) {
                const end = scanStringEnd(buf, pos, len);
                if (end > pos) {
                    const part = buf.slice(pos, end);
                    if (IS_V8 && end - pos > 32 && hasStringControl(part, pos, end, len)) {
                        this._pos = pos;
                        this._fail(this._syntaxError());
                    }
                    if (this._retainString || this._strSinks.length) this._str += part;
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
                if (buf.charCodeAt(pos) === CharCode.QUOTE) {
                    ++pos;
                    this._pos = pos;
                    this._closeString();
                } else {
                    if (IS_V8 && this._str.length >= 64 && len - pos >= 256) {
                        const run = readEscapedRun(
                            buf,
                            pos,
                            len,
                            this._retainString || this._strSinks.length > 0,
                        );
                        if (run.pos > pos) {
                            if (run.text) this._str += run.text;
                            pos = run.pos;
                            continue;
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
                    } else if (ch !== undefined && ch !== 'u') {
                        const value = ESCAPES[ch];
                        if (value === undefined) {
                            this._pos = pos;
                            this._fail(this._syntaxError());
                        }
                        if (this._retainString || this._strSinks.length) this._str += value;
                        pos += 2;
                    } else {
                        this._acc = ch === 'u' ? buf.slice(pos + 2) : '';
                        this._requiredLength = ch === 'u' ? 4 - this._acc.length : 0;
                        pos = len;
                        this._state = State.ESC;
                    }
                }
                continue;
            }
            switch (this._state) {
                case State.END:
                    if (this._framed) {
                        this._pos = pos;
                        return;
                    }
                    while (pos < len && isSpace(buf.charCodeAt(pos))) ++pos;
                    this._pos = pos;
                    if (pos < len) this._fail(this._syntaxError());
                    return;
                case State.FAILED:
                    this._pos = pos;
                    return;
                case State.VALUE:
                case State.OBJ_FIRST:
                case State.OBJ_KEY:
                case State.COLON:
                case State.OBJ_NEXT:
                case State.ARR_NEXT: {
                    while (pos < len && isSpace(buf.charCodeAt(pos))) ++pos;
                    if (pos >= len) {
                        this._pos = pos;
                        return;
                    }
                    const code = buf.charCodeAt(pos);
                    switch (this._state) {
                        case State.VALUE:
                            if (this._tracking)
                                this._context = this._stack.length
                                    ? (this._stack[this._stack.length - 1]!.arrayContext ??
                                      stepContext(
                                          this._stack[this._stack.length - 1]!.context,
                                          this._path[this._path.length - 1]!,
                                      ))
                                    : this._rootContext;
                            if (code === CharCode.LBRACE) {
                                ++pos;
                                this._open(false);
                                if ((this._state as number) === State.SKIP) {
                                    pos = this._skipInput(buf, pos, len);
                                    if ((this._state as number) === State.SKIP) {
                                        this._pos = pos;
                                        this._run = this._runDiscard;
                                        return;
                                    }
                                }
                            } else if (code === CharCode.LBRACKET) {
                                ++pos;
                                this._open(true);
                                if ((this._state as number) === State.SKIP) {
                                    pos = this._skipInput(buf, pos, len);
                                    if ((this._state as number) === State.SKIP) {
                                        this._pos = pos;
                                        this._run = this._runDiscard;
                                        return;
                                    }
                                }
                            } else if (
                                code === CharCode.RBRACKET &&
                                this._stack[this._stack.length - 1]?.isArray &&
                                this._stack[this._stack.length - 1]!.count === 0
                            ) {
                                ++pos;
                                this._close();
                            } else if (code === CharCode.QUOTE) {
                                ++pos;
                                this._keyMode = false;
                                this._retainString = this._shouldRetain();
                                if (this._hasChunks) this._findChunkSinks();
                                this._state = State.STR;
                            } else if (
                                (code >= CharCode.ZERO && code <= CharCode.NINE) ||
                                code === CharCode.MINUS
                            ) {
                                const start = pos,
                                    negative = code === CharCode.MINUS;
                                let finish = pos + (negative ? 1 : 0),
                                    digits = 0,
                                    integer = 0;
                                while (finish < len && digits < 8) {
                                    const digit = buf.charCodeAt(finish);
                                    if (digit < CharCode.ZERO || digit > CharCode.NINE) break;
                                    integer = integer * 10 + digit - CharCode.ZERO;
                                    ++finish;
                                    ++digits;
                                }
                                let next = buf.charCodeAt(finish);
                                if (
                                    digits &&
                                    (digits === 1 ||
                                        buf.charCodeAt(start + (negative ? 1 : 0)) !==
                                            CharCode.ZERO) &&
                                    finish < len &&
                                    (next === CharCode.COMMA ||
                                        next === CharCode.RBRACE ||
                                        next === CharCode.RBRACKET ||
                                        isSpace(next))
                                ) {
                                    pos = finish;
                                    this._pos = pos;
                                    this._acc = '';
                                    this._emit(negative ? -integer : integer);
                                    break;
                                }
                                // Grammar transitions occur between runs, never on each digit.
                                while (finish < len) {
                                    const digit = buf.charCodeAt(finish);
                                    if (digit < CharCode.ZERO || digit > CharCode.NINE) break;
                                    ++finish;
                                    ++digits;
                                }
                                let valid =
                                    digits > 0 &&
                                    (digits === 1 ||
                                        buf.charCodeAt(start + (negative ? 1 : 0)) !==
                                            CharCode.ZERO);
                                let phase = valid ? 1 : 0;
                                next = buf.charCodeAt(finish);
                                if (valid && next === CharCode.DOT) {
                                    const fractionStart = ++finish;
                                    phase = 2;
                                    while (finish < len) {
                                        const digit = buf.charCodeAt(finish);
                                        if (digit < CharCode.ZERO || digit > CharCode.NINE) break;
                                        ++finish;
                                    }
                                    valid = finish > fractionStart;
                                    if (valid) phase = 3;
                                    next = buf.charCodeAt(finish);
                                }
                                if (
                                    valid &&
                                    (next === CharCode.LOWER_E || next === CharCode.UPPER_E)
                                ) {
                                    ++finish;
                                    phase = 4;
                                    const sign = buf.charCodeAt(finish);
                                    if (sign === CharCode.PLUS || sign === CharCode.MINUS) {
                                        ++finish;
                                        phase = 5;
                                    }
                                    const exponentStart = finish;
                                    while (finish < len) {
                                        const digit = buf.charCodeAt(finish);
                                        if (digit < CharCode.ZERO || digit > CharCode.NINE) break;
                                        ++finish;
                                    }
                                    valid = finish > exponentStart;
                                    if (valid) phase = 6;
                                    next = buf.charCodeAt(finish);
                                }
                                if (
                                    valid &&
                                    finish < len &&
                                    (next === CharCode.COMMA ||
                                        next === CharCode.RBRACE ||
                                        next === CharCode.RBRACKET ||
                                        isSpace(next))
                                ) {
                                    pos = finish;
                                    this._pos = pos;
                                    this._acc = '';
                                    if (IS_V8) this._emitNumber(buf, start, finish);
                                    else this._emit(Number(buf.slice(start, finish)));
                                    break;
                                }
                                this._acc = buf.slice(start, finish);
                                this._numPhase = phase;
                                pos = finish;
                                this._state = State.NUM;
                            } else {
                                this._acc = '';
                                const literal = pos + 4 < len ? readLiteral(buf, pos, len) : 0;
                                if (literal) {
                                    pos += literal === 2 ? 5 : 4;
                                    this._pos = pos;
                                    this._emit(literal === 1 ? true : literal === 2 ? false : null);
                                } else {
                                    this._state = State.LIT;
                                }
                            }
                            break;
                        case State.OBJ_FIRST:
                        case State.OBJ_KEY:
                            // a trailing comma leaves OBJ_KEY facing the closing brace
                            if (code === CharCode.RBRACE && this._state === State.OBJ_FIRST) {
                                ++pos;
                                this._close();
                                break;
                            }
                            if (code !== CharCode.QUOTE) {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            ++pos;
                            this._keyMode = true;
                            this._retainString = this._needsKey();
                            if (this._hasChunks) this._state = State.STR;
                            else pos = this._readObjectKey(buf, pos, len);
                            break;
                        case State.COLON:
                            if (code !== CharCode.COLON) {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            ++pos;
                            this._state = State.VALUE;
                            break;
                        case State.OBJ_NEXT:
                            if (code === CharCode.RBRACE) {
                                ++pos;
                                this._close();
                            } else if (code === CharCode.COMMA) {
                                ++pos;
                                this._state = State.OBJ_KEY;
                            } else {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            break;
                        case State.ARR_NEXT:
                            if (code === CharCode.RBRACKET) {
                                ++pos;
                                this._close();
                            } else if (code === CharCode.COMMA) {
                                ++pos;
                                this._state = State.VALUE;
                            } else {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            break;
                    }
                    break;
                }
                case State.ESC: {
                    if (this._requiredLength === 0) {
                        if (pos === len) {
                            this._flushChunk();
                            this._pos = pos;
                            return;
                        }
                        const ch = buf[pos]!;
                        if (ch !== 'u') {
                            const escaped = ESCAPES[ch];
                            if (escaped === undefined) {
                                this._pos = pos;
                                this._fail(this._syntaxError());
                            }
                            if (this._retainString || this._strSinks.length) this._str += escaped;
                            ++pos;
                            this._state = State.STR;
                            break;
                        }
                        ++pos;
                        this._requiredLength = 4;
                    }
                    let value: number;
                    if (this._requiredLength === 4 && pos + 4 <= len) {
                        // All digits are in the new chunk: read them without copying.
                        value = readHex4(buf, pos);
                        pos += 4;
                    } else {
                        const take = Math.min(this._requiredLength, len - pos);
                        this._acc += buf.slice(pos, pos + take);
                        pos += take;
                        this._requiredLength -= take;
                        if (this._requiredLength) {
                            this._flushChunk();
                            this._pos = pos;
                            return;
                        }
                        value = readHex4(this._acc, 0);
                    }
                    if (value < 0) {
                        this._pos = pos;
                        this._fail(this._syntaxError());
                    }
                    if (this._retainString || this._strSinks.length)
                        this._str += unicodeUnit(value);
                    this._acc = '';
                    this._requiredLength = 0;
                    this._state = State.STR;
                    break;
                }
                case State.NUM: {
                    let end = pos,
                        phase = this._numPhase;
                    while (end < len) {
                        const code = buf.charCodeAt(end);
                        if (phase !== 7 && code >= CharCode.ZERO && code <= CharCode.NINE) {
                            // One grammar transition per digit run, not per digit.
                            if (phase === 0) phase = 1;
                            else if (phase === 2) phase = 3;
                            else if (phase === 4 || phase === 5) phase = 6;
                            do {
                                ++end;
                                if (end >= len) break;
                                const digit = buf.charCodeAt(end);
                                if (digit < CharCode.ZERO || digit > CharCode.NINE) break;
                            } while (true);
                            continue;
                        }
                        if (phase === 1 && code === CharCode.DOT) phase = 2;
                        else if (
                            (phase === 1 || phase === 3) &&
                            (code === CharCode.LOWER_E || code === CharCode.UPPER_E)
                        )
                            phase = 4;
                        else if (phase === 4 && (code === CharCode.PLUS || code === CharCode.MINUS))
                            phase = 5;
                        else if (
                            code === CharCode.MINUS ||
                            code === CharCode.PLUS ||
                            code === CharCode.DOT ||
                            code === CharCode.LOWER_E ||
                            code === CharCode.UPPER_E ||
                            (code >= CharCode.ZERO && code <= CharCode.NINE)
                        )
                            phase = 7;
                        else break;
                        ++end;
                    }
                    this._numPhase = phase;
                    if (end > pos) {
                        this._acc += buf.slice(pos, end);
                        pos = end;
                    }
                    this._pos = pos;
                    if (pos >= len) return;
                    this._closeNumber();
                    break;
                }
                case State.LIT: {
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
