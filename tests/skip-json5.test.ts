import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import JSON5 from 'json5';
import {
    Any,
    Rest,
    Json5Parser,
    JsonLinesParser,
    PrefixedJsonParser,
    createDecodedInput,
} from '../src/index';
import { Json5SubtreeValidator } from '../src/skip-json5';
import { State } from '../src/state';
import { IS_V8 } from '../src/lexical';

// JSON5's oracle warns about legal raw U+2028 in JSON5 strings.
beforeAll(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    jest.restoreAllMocks();
});

class Builder extends Json5Parser {
    protected _skipContainer(): boolean {
        return false;
    }
}
// Exercise array-rooted skipping as well as the production object-only V8 path.
class Skipper extends Json5Parser {
    protected _skipContainer(isArray: boolean): boolean {
        (this._skip ??= new Json5SubtreeValidator()).start(
            isArray,
            this._maxDepth - this._stack.length,
        );
        this._state = State.SKIP;
        return true;
    }
}
const parsers = IS_V8 ? [Json5Parser, Skipper, Builder] : [Json5Parser, Builder];
const bodies = [
    '[]',
    '{}',
    '{a:1, b:[.5,1.,+2,-0x10,Infinity,-Infinity,NaN,true,false,null,],}',
    "{'s':'π😀\\x41\\u0042\\0x\\q', a\\u0062: 3, '0': {__proto__: 1}}",
    "[/* block **/ 'line\\\r\ncontinued', // line\u2028 {漢字:'\\v'},]",
    "['raw\u0000tab\t', 'separator\u2028', 'slash\\\\quote\\'']",
];

test('JSON5 skipped grammar resumes selected values and string fragments at every cut', () => {
    let calls = 0;
    const run = Json5SubtreeValidator.prototype.run;
    Json5SubtreeValidator.prototype.run = function (...args) {
        calls++;
        return run.apply(this, args);
    };
    try {
        for (const body of bodies) {
            const text = `{ignored:${body}, items:[{id:1,text:'π😀'},{id:2,text:'end'}]}`;
            const oracle = JSON5.parse(text);
            for (let cut = 0; cut <= text.length; cut++)
                for (const Parser of parsers) {
                    const parser = new Parser({ collectJson: true }),
                        values: unknown[] = [],
                        parts: string[] = [];
                    parser.onValue(['items', Any, 'id'], (v, path) => values.push([v, [...path]]));
                    parser.onString('$.items[*].text', (part) => parts.push(part));
                    parser.write(text.slice(0, cut));
                    parser.end(text.slice(cut));
                    expect(values).toEqual(
                        oracle.items.map((item: { id: number }, i: number) => [
                            item.id,
                            ['items', i, 'id'],
                        ]),
                    );
                    expect(parts.join('')).toBe('π😀end');
                    expect(parser.json).toBe(text);
                }
        }
    } finally {
        Json5SubtreeValidator.prototype.run = run;
    }
    expect(calls > 0).toBe(IS_V8);
});

test('JSON5 ignored input agrees with independent acceptance oracle across mutations and cuts', () => {
    let seed = 0x12345678;
    const random = (n: number) => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) % n;
    };
    const alphabet = 'abc019+-.e:{}[],\'"\\/* \n\r';
    for (let i = 0; i < 2000; i++) {
        let body = bodies[random(bodies.length)]!;
        for (let j = 0, n = random(4); j < n; j++) {
            const at = random(body.length + 1);
            body =
                body.slice(0, at) + alphabet[random(alphabet.length)] + body.slice(at + random(2));
        }
        const text = `{ignored:${body},keep:7}`;
        let valid = true;
        try {
            JSON5.parse(text);
        } catch {
            valid = false;
        }
        for (const Parser of parsers) {
            const parser = new Parser();
            parser.onValue('$.keep', () => {});
            const cut = random(text.length + 1);
            let accepted = true;
            try {
                parser.write(text.slice(0, cut));
                parser.end(text.slice(cut));
            } catch {
                accepted = false;
            }
            expect({ text, accepted, Parser: Parser.name }).toEqual({
                text,
                accepted: valid,
                Parser: Parser.name,
            });
        }
    }
});

test('JSON5 skipped malformed escapes, comments and trailing values fail at every cut', () => {
    for (const body of [
        "['\\01']",
        "['\\9']",
        "['\\xG0']",
        "['\\u12G4']",
        "['a\nb']",
        '[,]',
        '{a:}',
        '{a:1 b:2}',
        '[1,,]',
        '[01]',
        '[1e+]',
        '[0x]',
        '[truefalse]',
        '[/* unfinished]',
        '{\\u0030:1}',
        '{a\\x41:1}',
    ]) {
        const text = `{ignored:{nested:${body}},keep:1}`;
        for (let cut = 0; cut <= text.length; cut++) {
            const parser = new Json5Parser();
            parser.onValue('$.keep', () => {});
            expect(() => {
                parser.write(text.slice(0, cut));
                parser.end(text.slice(cut));
            }).toThrow(SyntaxError);
        }
    }
});

test('JSON5 skip respects retained ancestors, recursive consumers, reset and depth', () => {
    for (const path of ['$', '$..id', ['ignored', Rest]] as const) {
        const parser = new Json5Parser();
        const found: unknown[] = [];
        parser.onValue(path, (v) => found.push(v));
        parser.end('{ignored:{id:1,a:{id:2}},keep:3}');
        expect(found.length).toBeGreaterThan(0);
    }
    const text = '{a:{nested:[{}]},keep:1}';
    for (const maxDepth of [0, 1, 2, 3])
        for (let cut = 0; cut <= text.length; cut++) {
            const parser = new Json5Parser({ maxDepth });
            parser.onValue('$.keep', () => {});
            expect(() => {
                parser.write(text.slice(0, cut));
                parser.end(text.slice(cut));
            }).toThrow('Json nesting deeper than ' + maxDepth);
        }
    const atLimit = new Json5Parser({ maxDepth: 4 });
    let kept: unknown;
    atLimit.onValue('$.keep', (v) => (kept = v));
    atLimit.end(text);
    expect(kept).toBe(1);
    for (const parser of [
        new JsonLinesParser({ format: 'json5' }),
        new PrefixedJsonParser('START', { format: 'json5' }),
    ]) {
        const found: unknown[] = [];
        parser.onValue('$.keep', (v) => found.push(v));
        const text =
            parser instanceof JsonLinesParser
                ? '{skip:[1,2],keep:1}\n{skip:{a:2},keep:2}\n'
                : 'START{skip:[1,2],keep:1}START{skip:{a:2},keep:2}';
        for (const char of text) parser.write(char);
        parser.end();
        expect(found).toEqual([1, 2]);
        expect(parser.recordCount).toBe(2);
    }
});

test('ignored JSON5 objects resume following strings at every UTF-8 cut in both memory modes', () => {
    const text =
        "{ignored:{a:['π😀', 0xAB, -Infinity,], b:'\\u0041', /* comment */}, text:'П😀\\x41'}";
    const bytes = new TextEncoder().encode(text);
    for (const memoryMode of ['fast', 'compact'] as const)
        for (let cut = 0; cut <= bytes.length; ++cut) {
            const parser = new Json5Parser({ memoryMode });
            const input = createDecodedInput(parser);
            const parts: string[] = [];
            let value: unknown;
            parser.onString('$.text', (part) => parts.push(part));
            parser.onValue('$.text', (v) => (value = v));
            input.write(bytes.subarray(0, cut));
            input.write(bytes.subarray(cut));
            input.end();
            expect(parts.join('')).toBe('П😀A');
            expect(value).toBe('П😀A');
            expect(parser.finished).toBe(true);
        }
});

test('selected containers retain all descendants while neighboring objects are skipped', () => {
    const text = "{ignored:{x:[1,2]},keep:{nested:{list:[{id:7,text:'π😀'}]},other:null}}";
    const parser = new Json5Parser();
    let value: unknown;
    const ids: unknown[] = [];
    parser.onValue('$.keep', (v) => (value = v));
    parser.onValue('$.keep.nested.list[*].id', (v) => ids.push(v));
    for (const char of text) parser.write(char);
    parser.end();
    expect(value).toEqual(JSON5.parse(text).keep);
    expect(ids).toEqual([7]);
});

test('incomplete ignored JSON5 branches still fail at EOF, including pending escapes and comments', () => {
    for (const body of [
        "{a:'unfinished",
        "{a:'\\u12",
        "{a:'\\xA",
        "{a:'\\0",
        '{/* unfinished',
        '{a:[1,',
        '{a:Infinity',
    ]) {
        const parser = new Json5Parser();
        parser.onValue('$.keep', () => {});
        for (const char of '{ignored:' + body) parser.write(char);
        expect(() => parser.end()).toThrow(SyntaxError);
        expect(parser.closed).toBe(true);
    }
});

test('cancellation and sibling parser cleanup do not corrupt pending JSON5 skip state', () => {
    const parser = new Json5Parser();
    const values: unknown[] = [];
    parser.onValue('$.keep', (v) => {
        values.push(v);
        const other = new Json5Parser();
        other.onValue('$.keep', () => {});
        other.write("{ignored:{a:'unfinished");
        other.destroy();
    });
    parser.write("{ignored:{a:'prefix");
    const other = new Json5Parser();
    other.onValue('$.keep', () => {});
    other.end('{ignored:{a:0x1},keep:2}');
    parser.write("suffix'},keep:7}");
    parser.reset();
    parser.write('{ignored:{a:[1,2]},keep:8}');
    parser.end();
    expect(values).toEqual([7, 8]);

    const canceled = new Json5Parser();
    const callback = jest.fn();
    canceled.onValue('$.keep', callback);
    canceled.write("{ignored:{a:'unfinished");
    canceled.destroy();
    expect(canceled.closed).toBe(true);
    expect(callback).not.toHaveBeenCalled();
});

test('standalone JSON5 validator accepts complete objects and arrays at every cut', () => {
    for (const body of bodies)
        for (let cut = 1; cut <= body.length; ++cut) {
            const validator = new Json5SubtreeValidator();
            validator.start(body[0] === '[', Infinity);
            const first = body.slice(1, cut);
            const rest = body.slice(cut);
            expect(validator.run(first, 0, first.length)).toBe(first.length);
            expect(validator.run(rest, 0, rest.length)).toBe(rest.length);
            expect(validator.error).toBe(-1);
            expect(validator.done).toBe(true);
            validator.release();
        }
});
