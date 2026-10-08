import {hexDigit, isSpace} from './lexical.js';

// A validation-only stack. No decoded keys, values, concrete paths or emitters.
const enum Expect {ArrayFirst, ArrayValue, ArrayNext, ObjectFirst, ObjectKey, Colon, ObjectValue, ObjectNext}
const enum Token {None, String, Escape, Hex, Number, Literal}
const STRING_STOP = /["\\\u0000-\u001f]/g;

export class JsonSubtreeValidator {
    private stack: Expect[] = [];
    private token = Token.None;
    private phase = 0;
    private literal = '';
    private offset = 0;
    private limit = 0;
    done = false;
    error = -1;

    start(array: boolean, limit: number): void {
        this.stack.length = 0;
        this.stack.push(array ? Expect.ArrayFirst : Expect.ObjectFirst);
        this.token = Token.None;
        this.limit = limit;
        this.done = false;
        this.error = -1;
    }
    release(): void {
        STRING_STOP.lastIndex = 0;
        STRING_STOP.test('"');
        this.stack.length = 0;
        this.token = Token.None;
        this.literal = '';
    }
    run(buf: string, pos: number, len: number): number {
        while (pos < len) {
            if (this.token === Token.String) {
                const prefixEnd = Math.min(len, pos + 32);
                while (pos < prefixEnd) {
                    const code = buf.charCodeAt(pos);
                    if (code === 34 || code === 92 || code < 32) break;
                    ++pos;
                }
                if (pos === len) return pos;
                if (pos === prefixEnd) {
                    STRING_STOP.lastIndex = pos;
                    if (!STRING_STOP.test(buf)) return len;
                    pos = STRING_STOP.lastIndex - 1;
                }
                const code = buf.charCodeAt(pos++);
                if (code < 32) {this.error = pos - 1; return pos;}
                this.token = code === 34 ? Token.None : Token.Escape;
                continue;
            }
            if (this.token === Token.Escape) {
                const code = buf.charCodeAt(pos++);
                if (code === 117) {this.phase = 4; this.token = Token.Hex;}
                else if (code === 34 || code === 92 || code === 47 || code === 98 || code === 102 || code === 110 || code === 114 || code === 116)
                    this.token = Token.String;
                else {this.error = pos - 1; return pos;}
                continue;
            }
            if (this.token === Token.Hex) {
                while (pos < len && this.phase) {
                    if (hexDigit(buf.charCodeAt(pos)) < 0) {this.error = pos; return pos;}
                    ++pos; --this.phase;
                }
                if (!this.phase) this.token = Token.String;
                continue;
            }
            if (this.token === Token.Literal) {
                while (pos < len && this.offset < this.literal.length) {
                    if (buf.charCodeAt(pos) !== this.literal.charCodeAt(this.offset)) {this.error = pos; return pos;}
                    ++pos; ++this.offset;
                }
                if (this.offset === this.literal.length) this.token = Token.None;
                continue;
            }
            if (this.token === Token.Number) {
                let phase = this.phase;
                while (pos < len) {
                    const code = buf.charCodeAt(pos), digit = code >= 48 && code <= 57;
                    if (digit && phase !== 1) {
                        if (phase === 0) {phase = code === 48 ? 1 : 2; ++pos; continue;}
                        phase = phase === 2 ? 2 : phase === 3 || phase === 4 ? 4 : 7;
                        do {++pos;} while (pos < len && buf.charCodeAt(pos) >= 48 && buf.charCodeAt(pos) <= 57);
                        continue;
                    }
                    if (code === 46 && (phase === 1 || phase === 2)) {phase = 3; ++pos; continue;}
                    if ((code === 101 || code === 69) && (phase === 1 || phase === 2 || phase === 4)) {phase = 5; ++pos; continue;}
                    if ((code === 43 || code === 45) && phase === 5) {phase = 6; ++pos; continue;}
                    if (phase === 0 || phase === 3 || phase === 5 || phase === 6) {this.error = pos; return pos;}
                    this.token = Token.None;
                    break;
                }
                this.phase = phase;
                if (pos === len) return pos;
                continue;
            }
            let code = buf.charCodeAt(pos);
            if (isSpace(code)) {++pos; continue;}
            const top = this.stack.length - 1, expect = this.stack[top]!;
            if (expect === Expect.Colon) {
                if (code !== 58) {this.error = pos; return pos;}
                this.stack[top] = Expect.ObjectValue; ++pos; continue;
            }
            if (expect === Expect.ArrayNext || expect === Expect.ObjectNext) {
                const array = expect === Expect.ArrayNext;
                if (code === 44) {this.stack[top] = array ? Expect.ArrayValue : Expect.ObjectKey; ++pos; continue;}
                if (code !== (array ? 93 : 125)) {this.error = pos; return pos;}
                ++pos; this.stack.pop();
                if (!this.stack.length) {this.done = true; return pos;}
                continue;
            }
            if (expect === Expect.ObjectFirst || expect === Expect.ObjectKey) {
                if (code === 125 && expect === Expect.ObjectFirst) {
                    ++pos; this.stack.pop();
                    if (!this.stack.length) {this.done = true; return pos;}
                    continue;
                }
                if (code !== 34) {this.error = pos; return pos;}
                this.stack[top] = Expect.Colon; this.token = Token.String; ++pos; continue;
            }
            if (expect === Expect.ArrayFirst && code === 93) {
                ++pos; this.stack.pop();
                if (!this.stack.length) {this.done = true; return pos;}
                continue;
            }
            this.stack[top] = expect === Expect.ObjectValue ? Expect.ObjectNext : Expect.ArrayNext;
            if (code === 123 || code === 91) {
                if (this.stack.length >= this.limit) {this.error = pos; return pos;}
                this.stack.push(code === 91 ? Expect.ArrayFirst : Expect.ObjectFirst); ++pos;
            }
            else if (code === 34) {this.token = Token.String; ++pos;}
            else if (code === 45 || code >= 48 && code <= 57) {
                this.token = Token.Number; this.phase = code === 45 ? 0 : code === 48 ? 1 : 2; ++pos;
            }
            else if (code === 116 || code === 102 || code === 110) {
                this.literal = code === 116 ? 'true' : code === 102 ? 'false' : 'null';
                this.offset = 1; this.token = Token.Literal; ++pos;
            }
            else {this.error = pos; return pos;}
        }
        return pos;
    }
}
