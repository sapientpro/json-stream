import { expect, test } from '@jest/globals';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { runInNewContext } from 'node:vm';
import { JsonParser } from '../src/index';
import { JsonStream, createNodeWritable } from '../src/node';

for (const mode of ['JsonStream', 'createNodeWritable']) {
    const setup = () => {
        if (mode === 'JsonStream') {
            const stream = new JsonStream();
            return { parser: stream, stream };
        }
        const parser = new JsonParser();
        return { parser, stream: createNodeWritable(parser) };
    };
    const reasons: unknown[] = [
        'upstream failed',
        { detail: 'upstream failed' },
        42,
        Symbol('upstream failed'),
        {
            toString() {
                throw new Error('cannot stringify');
            },
        },
        new Error('upstream failed'),
        runInNewContext('new TypeError("other realm")'),
    ];
    for (const via of ['destroy', 'pipeline']) {
        test(`${mode}: ${via} settles parser consumers for arbitrary upstream failures`, async () => {
            for (const reason of reasons) {
                const { parser, stream } = setup();
                const errors: unknown[] = [],
                    streamErrors: unknown[] = [];
                let completed = 0;
                parser.onValue('$', {
                    next() {},
                    error: (error: unknown) => {
                        errors.push(error);
                    },
                    complete: () => {
                        completed++;
                    },
                });
                stream.on('error', (error) => {
                    streamErrors.push(error);
                });
                const value = parser.getValue().then(
                    (result) => ({ result, error: undefined }),
                    (error: unknown) => ({ result: undefined, error }),
                );
                if (via === 'destroy') {
                    const closed = new Promise<void>((resolve) => stream.once('close', resolve));
                    stream.write('[1,');
                    expect(() => stream.destroy(reason as Error)).not.toThrow();
                    await closed;
                } else {
                    const source = Readable.from(
                        (async function* () {
                            yield '[1,';
                            throw reason;
                        })(),
                    );
                    await expect(pipeline(source, stream)).rejects.toBe(reason);
                }
                const rejected = (await value).error as Error;
                expect(rejected).toBeDefined();
                expect(errors).toEqual([rejected]);
                expect(completed).toBe(0);
                expect(stream.destroyed).toBe(true);
                expect(streamErrors).toEqual([reason]);
                if (reason === reasons[5] || reason === reasons[6]) {
                    expect(rejected).toBe(reason);
                } else {
                    expect(rejected).toBeInstanceOf(Error);
                    expect(rejected.cause).toBe(reason);
                    if (reason === reasons[0]) expect(rejected.message).toBe('upstream failed');
                }
            }
        });
    }
}
