import { expect, test } from '@jest/globals';
import JSON5 from 'json5';
import { JsonParser, Json5Parser, Rest } from '../src/index';
import type { PathSegment } from '../src/types';

type Entry = [unknown, PathSegment[]];
// Independent tree walk: expected completion order comes from the oracle result,
// never from the parser's selector contexts or emitter implementation.
function completed(value: unknown, path: PathSegment[] = []): Entry[] {
    const entries: Entry[] = [];
    if (value !== null && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            const segment = Array.isArray(value) ? Number(key) : key;
            entries.push(...completed((value as Record<string, unknown>)[key], [...path, segment]));
        }
    }
    entries.push([value, path]);
    return entries;
}

for (const [Parser, oracle, stringify] of [
    [JsonParser, JSON.parse, JSON.stringify],
    [Json5Parser, JSON5.parse, JSON5.stringify],
] as const) {
    test(`${Parser.name}: seeded differential values, emitter routes and chunk cuts`, () => {
        let seed = 0x51f15e;
        const random = (limit: number): number => {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return (seed >>> 0) % limit;
        };
        const scalar = () =>
            [
                null,
                true,
                false,
                -0,
                random(1000) / 7,
                1e200,
                'π😀\\\n',
                '',
                '\ud800',
                Infinity,
                NaN,
            ][random(11)];
        const generate = (depth: number): unknown => {
            if (!depth || random(3) === 0) return scalar();
            if (random(2)) return Array.from({ length: random(5) }, () => generate(depth - 1));
            const object: Record<string, unknown> = Object.create(null);
            for (const key of ['__proto__', 'n', '0', 'text'].slice(0, 1 + random(4)))
                object[key] = generate(depth - 1);
            return object;
        };
        for (let index = 0; index < 150; index++) {
            const text = stringify(generate(4))!;
            const expected = oracle(text),
                entries = completed(expected);
            for (const mode of ['root', 'tracked', 'descendants', 'missing', 'none']) {
                const parser = new Parser(),
                    roots: unknown[] = [],
                    actual: Entry[] = [];
                const fragments = new Map<string, string>();
                const ended: Entry[] = [];
                if (mode === 'root' || mode === 'tracked')
                    parser.onValue('$', (v) => roots.push(v));
                if (mode === 'tracked' || mode === 'descendants')
                    parser.onValue([Rest], (value, path) => actual.push([value, [...path]]));
                if (mode === 'tracked' || mode === 'descendants')
                    parser.onString([Rest], {
                        next: (chunk, path) => {
                            const key = JSON.stringify(path);
                            fragments.set(key, (fragments.get(key) ?? '') + chunk);
                        },
                        end: (path) =>
                            ended.push([fragments.get(JSON.stringify(path)) ?? '', [...path]]),
                    });
                if (mode === 'missing')
                    parser.onValue('$.neverPresent', (value) => actual.push([value, []]));
                for (let pos = 0; pos < text.length; ) {
                    const end = Math.min(text.length, pos + 1 + random(19));
                    parser.write(text.slice(pos, end));
                    pos = end;
                }
                parser.end();
                if (mode === 'tracked' || mode === 'descendants')
                    expect(ended).toEqual(
                        entries.slice(0, -1).filter(([value]) => typeof value === 'string'),
                    );
                expect({ index, mode, roots, actual }).toEqual({
                    index,
                    mode,
                    roots: mode === 'root' || mode === 'tracked' ? [expected] : [],
                    actual:
                        mode === 'tracked' || mode === 'descendants' ? entries.slice(0, -1) : [],
                });
            }
        }
        const fixtures = ['{"n":[0,-0,1.25,1e200],"__proto__":{"n":2}}', '[true,null,"\\uD800"]'];
        const alphabet = '0e+-.,:{}[]"\\ \nxyz';
        for (let index = 0; index < 400; index++) {
            const source = fixtures[random(fixtures.length)]!;
            const pos = random(source.length + 1),
                char = alphabet[random(alphabet.length)]!;
            const text = source.slice(0, pos) + char + source.slice(pos + random(2));
            let valid = true,
                expected: unknown;
            try {
                expected = oracle(text);
            } catch {
                valid = false;
            }
            for (const mode of ['root', 'tracked', 'missing', 'none']) {
                const parser = new Parser(),
                    roots: unknown[] = [];
                if (mode === 'root' || mode === 'tracked')
                    parser.onValue('$', (v) => roots.push(v));
                if (mode === 'tracked') parser.onValue([Rest], () => {});
                if (mode === 'missing') parser.onValue('$.neverPresent', () => {});
                const cut = random(text.length + 1);
                let accepted = true;
                try {
                    parser.write(text.slice(0, cut));
                    parser.end(text.slice(cut));
                } catch {
                    accepted = false;
                }
                expect({ index, text, mode, accepted }).toEqual({
                    index,
                    text,
                    mode,
                    accepted: valid,
                });
                if (valid && (mode === 'root' || mode === 'tracked'))
                    expect(roots).toEqual([expected]);
            }
        }
    });
}
