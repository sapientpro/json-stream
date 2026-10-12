import { describe, expect, test } from '@jest/globals';
import { finished } from 'node:stream/promises';
import {
    compileSelectors,
    JsonParser,
    Json5Parser,
    Any,
    Rest,
    createDecodedInput,
} from '../src/index';
import { createNodeWritable } from '../src/node';
import { DOCUMENT_INPUT } from '../src/document-input';

describe.each([JsonParser, Json5Parser])('%s compiled subscription plans', (Parser) => {
    test('keeps callbacks, cancellation and lifecycle isolated across interleaved instances', () => {
        const plan = compileSelectors(['$..id', { path: '$..text', kind: 'string' }]);
        const a = new Parser(),
            b = new Parser(),
            left: unknown[] = [],
            right: unknown[] = [];
        let complete = 0;
        const subscriptions = plan.bind(a, [
            { next: (v, p) => left.push([v, p]), complete: () => ++complete },
            (v, p) => left.push([v, p]),
        ]);
        plan.bind(b, [(v, p) => right.push([v, p]), (v, p) => right.push([v, p])]);
        a.write('{"id":1,"text":"a');
        b.end('{"id":2,"text":"b"}');
        subscriptions[0]!.unsubscribe();
        a.end('bc","nested":{"id":3}}');
        expect(left.filter(([v]: any) => typeof v === 'number')).toEqual([[1, ['id']]]);
        expect(right).toEqual([
            [2, ['id']],
            ['b', ['text']],
        ]);
        expect(
            left
                .filter(([v]: any) => typeof v === 'string')
                .map(([v]: any) => v)
                .join(''),
        ).toBe('abc');
        expect(complete).toBe(0);
    });
    test('cancellation before start and during a callback stays canceled after reset', () => {
        const plan = compileSelectors(['$..id', '$..id', { path: '$..text', kind: 'string' }]);
        const p = new Parser(),
            values: unknown[] = [],
            fragments: string[] = [];
        const subs = plan.bind(p, [
            () => {
                throw Error('canceled');
            },
            (v) => {
                values.push(v);
                subs[1]!.unsubscribe();
            },
            (v) => fragments.push(v),
        ]);
        subs[0]!.unsubscribe();
        subs[2]!.unsubscribe();
        p.write('{"id":1,"nested":{"id":2,"text":"ignored"}}');
        p.reset();
        p.end('{"id":3,"text":"ignored"}');
        expect(values).toEqual([1]);
        expect(fragments).toEqual([]);
    });
    test('ordinary registrations and another plan invalidate prepared contexts', async () => {
        const p = new Parser(),
            found: unknown[] = [],
            strings: string[] = [];
        compileSelectors(['$.id']).bind(p, [(v) => found.push(v)]);
        p.onValue('$.extra', (v) => found.push(v));
        const value = p.getValue();
        const fragments = p.stringStream('$.text');
        const read = (async () => {
            for await (const chunk of fragments) strings.push(chunk);
        })();
        compileSelectors(['$.nested.id']).bind(p, [(v) => found.push(v)]);
        p.end('{"id":1,"extra":2,"text":"hello","nested":{"id":3}}');
        await read;
        expect(await value).toEqual({ id: 1, extra: 2, text: 'hello', nested: { id: 3 } });
        expect(found).toEqual([1, 2, 3]);
        expect(strings.join('')).toBe('hello');
    });
    test('a prepared plan retains the complete root when it includes a root consumer', () => {
        const p = new Parser(),
            values: unknown[] = [];
        compileSelectors(['$', '$.id']).bind(p, [(v) => values.push(v), (v) => values.push(v)]);
        const text = '{"id":1,"__proto__":{"safe":true},"other":[2,3]}';
        p.end(text);
        expect(values).toEqual([1, JSON.parse(text)]);
        expect(Object.hasOwn(values[1] as object, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(values[1])).toBe(Object.prototype);
    });
    test('a root plan added after a descendant plan requests complete retention', () => {
        const p = new Parser(),
            got: unknown[] = [];
        compileSelectors(['$.id']).bind(p, [(v) => got.push(v)]);
        compileSelectors(['$']).bind(p, [(v) => got.push(v)]);
        p.end('{"id":1,"other":{"deep":[2,3]}}');
        expect(got).toEqual([1, { id: 1, other: { deep: [2, 3] } }]);
    });
    test('invalid first input can be retried and invalid registrations leave bindings usable', () => {
        const p = new Parser(),
            got: unknown[] = [];
        compileSelectors(['$.id']).bind(p, [(v) => got.push(v)]);
        expect(() => p.write(new Uint8Array() as any)).toThrow(TypeError);
        expect(() => p.onValue('bad', () => {})).toThrow(SyntaxError);
        p.end('{"id":42}');
        expect(got).toEqual([42]);
    });
    test('destroy before input releases the prepared plan and fails consumers once', () => {
        const p = new Parser(),
            errors: unknown[] = [],
            failure = Error('stop');
        compileSelectors(['$.id']).bind(p, [{ next: () => {}, error: (e) => errors.push(e) }]);
        p.destroy(failure);
        p.destroy();
        expect(errors).toEqual([failure]);
        expect((p as any)._preparedContext).toBeUndefined();
        expect(() => p.write('')).toThrow(failure);
    });
    test('can bind after ordinary registrations and handles root-only/empty plans', () => {
        const p = new Parser(),
            got: unknown[] = [];
        p.onValue('$.id', (v) => got.push(v));
        compileSelectors(['$.extra']).bind(p, [(v) => got.push(v)]);
        expect(compileSelectors([]).bind(p, [])).toEqual([]);
        compileSelectors(['$']).bind(p, [(v) => got.push(v)]);
        p.end('{"id":1,"extra":2}');
        expect(got).toEqual([1, 2, { id: 1, extra: 2 }]);
        const root = new Parser();
        compileSelectors(['$']).bind(root, [(v) => got.push(v)]);
        root.end('[1]');
        expect(got.at(-1)).toEqual([1]);
    });
    test.each(['fast', 'compact'] as const)(
        'supports %s memory mode and byte wrappers',
        (memoryMode) => {
            const plan = compileSelectors(['$.text', { path: '$.text', kind: 'string' }, '$.id']);
            const p = new Parser({ memoryMode }),
                values: unknown[] = [],
                fragments: string[] = [];
            plan.bind(p, [(v) => values.push(v), (v) => fragments.push(v), (v) => values.push(v)]);
            const input = createDecodedInput(p);
            const text = JSON.stringify({ padding: ' '.repeat(70000), text: '😀πПривіт', id: 42 });
            const bytes = new TextEncoder().encode(text),
                split = bytes.indexOf(240) + 2;
            input.write(bytes.subarray(0, split));
            input.write(bytes.subarray(split));
            input.end();
            expect(values).toEqual(['😀πПривіт', 42]);
            expect(fragments.join('')).toBe('😀πПривіт');
            expect(p.json).toBe('');
        },
    );
    test('Web and Node writable adapters accept a bound parser', async () => {
        const plan = compileSelectors(['$.id']);
        for (const node of [false, true]) {
            const p = new Parser(),
                got: unknown[] = [];
            plan.bind(p, [(v) => got.push(v)]);
            if (node) {
                const writable = createNodeWritable(p);
                writable.end(Buffer.from('{"id":42}'));
                await finished(writable);
            } else {
                const writer = p.writable.getWriter();
                await writer.write(new TextEncoder().encode('{"id":42}'));
                await writer.close();
            }
            expect(got).toEqual([42]);
        }
    });
    test('reset preserves plan consumers with framed cursor input and collectJson', () => {
        const plan = compileSelectors(['$.id']);
        const p = new Parser({ strictEnd: false, collectJson: true }),
            got: unknown[] = [];
        plan.bind(p, [(v) => got.push(v)]);
        const text = 'prefix {"id":1}{"id":2}';
        const tail = p[DOCUMENT_INPUT](text, 7);
        expect(text.slice(text.length - tail)).toBe('{"id":2}');
        expect(p.json).toBe('{"id":1}');
        p.reset();
        expect(p.json).toBe('');
        expect(p.write(text.slice(text.length - tail))).toBe(0);
        p.end();
        expect(got).toEqual([1, 2]);
    });
    test('destroy from a callback prevents subsequent emissions and reentrant writes fail', () => {
        const plan = compileSelectors(['$..id']);
        const p = new Parser(),
            got: unknown[] = [];
        plan.bind(p, [
            (v) => {
                got.push(v);
                expect(() => p.write('')).toThrow('re-entered');
                p.destroy();
            },
        ]);
        p.write('{"id":1,"nested":{"id":2}}');
        expect(got).toEqual([1]);
        expect(p.closed).toBe(true);
        expect(() => plan.bind(p, [() => {}])).toThrow('before the first write');
    });
    test('reports callback errors without stopping other consumers', () => {
        const errors: unknown[] = [],
            got: unknown[] = [],
            failure = Error('observer');
        const p = new Parser({ onObserverError: (e) => errors.push(e) });
        compileSelectors(['$.id', '$.id']).bind(p, [
            () => {
                throw failure;
            },
            (v) => got.push(v),
        ]);
        p.end('{"id":1}');
        expect(errors).toEqual([failure]);
        expect(got).toEqual([1]);
    });
    test('reports syntax errors, empty input and depth errors through independent channels', () => {
        const plan = compileSelectors(['$.id']);
        for (const text of ['', '{"id":', '{"x":[[[1]]]}']) {
            const errors: unknown[] = [];
            const p = new Parser({ maxDepth: 2 });
            plan.bind(p, [{ next: () => {}, error: (e) => errors.push(e) }]);
            expect(() => p.end(text)).toThrow();
            expect(errors).toHaveLength(1);
            expect(() => plan.bind(p, [() => {}])).toThrow('before the first write');
        }
        const p = new Parser();
        let v: unknown;
        plan.bind(p, [
            (x) => {
                v = x;
            },
        ]);
        p.end('{"id":42}');
        expect(v).toBe(42);
    });
    test('matches ordinary dispatch at every split with overlapping Rest and typed keys', () => {
        const definitions = [
            [Rest, 'id'],
            [Rest, Any],
            ['items', Any, 'id'],
            [0],
            ['0'],
            { path: [Rest, 'text'], kind: 'string' },
        ] as const;
        const plan = compileSelectors(definitions);
        for (const text of [
            '{"id":1,"items":[{"id":2,"text":"😀\\u0061"}],"0":3}',
            '[{"id":1,"text":"hi"}]',
        ])
            for (let cut = 0; cut <= text.length; cut++) {
                const run = (planned: boolean) => {
                    const got: unknown[] = [];
                    const p = new Parser();
                    const callbacks = definitions.map((_, i) => ({
                        next: (v: any, path: readonly (string | number)[]) =>
                            got.push([i, v, path]),
                        end: (path: readonly (string | number)[]) => got.push(['end', i, path]),
                        complete: () => got.push(['complete', i]),
                    }));
                    if (planned) plan.bind(p, callbacks);
                    else
                        definitions.forEach((def, i) => {
                            if (Array.isArray(def)) p.onValue(def, callbacks[i]!);
                            else p.onString((def as any).path, callbacks[i]!);
                        });
                    p.write(text.slice(0, cut));
                    p.end(text.slice(cut));
                    return got;
                };
                expect(run(true)).toEqual(run(false));
            }
    });
});

test('validates the complete binding before changing the parser', () => {
    const plan = compileSelectors(['$.a', '$.b']),
        p = new JsonParser(),
        got: unknown[] = [];
    for (const callbacks of [[() => {}], [() => {}, null], new Array(2)])
        expect(() => plan.bind(p, callbacks as any)).toThrow(TypeError);
    expect(() => plan.bind({} as any, [() => {}, () => {}])).toThrow(TypeError);
    p.onValue('$', (v) => got.push(v));
    p.end('{"a":1}');
    expect(got).toEqual([{ a: 1 }]);
    expect(() => plan.bind(p, [() => {}, () => {}])).toThrow('before the first write');
});

test.each([null, {}, ['bad'], [[-1]], [[1.5]], [[Symbol()]], [{ path: '$.a', kind: 'bad' }], [{}]])(
    'rejects invalid plan %p',
    (definitions) => {
        expect(() => compileSelectors(definitions as any)).toThrow();
    },
);

test('snapshots mutable paths and definitions at compilation', () => {
    const path = ['id'];
    const definition = { path, kind: 'value' as const };
    const definitions = [definition];
    const plan = compileSelectors(definitions);
    path[0] = 'other';
    definitions.length = 0;
    const p = new JsonParser();
    let got: unknown;
    plan.bind(p, [
        (v) => {
            got = v;
        },
    ]);
    p.end('{"id":42,"other":0}');
    expect(got).toBe(42);
    expect(Object.isFrozen(plan)).toBe(true);
});

test('falls back to lazy contexts when the prepared state budget is exceeded', () => {
    const paths = Array.from({ length: 4100 }, (_, i) => '$.k' + i),
        plan = compileSelectors(paths),
        got: unknown[] = [];
    const p = new JsonParser();
    plan.bind(
        p,
        paths.map(() => (v) => got.push(v)),
    );
    p.end('{"k0":1,"ignored":{"x":1},"k4099":2}');
    expect(got).toEqual([1, 2]);
});

test('prepared JSON5 consumers preserve comments, hex values and split Unicode escapes', () => {
    const p = new Json5Parser(),
        values: unknown[] = [],
        fragments: string[] = [];
    compileSelectors(['$.value', { path: '$.message', kind: 'string' }]).bind(p, [
        (v) => values.push(v),
        (text) => fragments.push(text),
    ]);
    p.write('/*prefix*/{value:0x2');
    p.write("a,message:'hi\\u00");
    p.end("61',extra:/*skip*/{x:1,},}//trailer");
    expect(values).toEqual([42]);
    expect(fragments.join('')).toBe('hia');
});
