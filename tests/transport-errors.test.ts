import { expect, test } from '@jest/globals';
import { runInNewContext } from 'node:vm';
import { JsonParser, createDecodedInput } from '../src/index';

for (const method of ['write', 'end'] as const) {
    test(`custom sink ${method} failures preserve thrown values and settle parser consumers`, async () => {
        for (const reason of [false, 0, '', undefined, null, 'failed', { detail: 'failed' }]) {
            const parser = new JsonParser();
            const value = parser.getValue().catch((error: unknown) => error);
            const input = createDecodedInput({
                write() {
                    if (method === 'write') throw reason;
                },
                end() {
                    if (method === 'end') throw reason;
                },
                destroy(error) {
                    parser.destroy(error);
                },
            });
            for (const call of [
                () => input[method](''),
                () => input.write(''),
                () => input.end(),
            ]) {
                let caught = false;
                try {
                    call();
                } catch (error) {
                    caught = true;
                    expect(error).toBe(reason);
                }
                expect(caught).toBe(true);
            }
            const rejected = await value;
            expect(rejected).toBeInstanceOf(Error);
            expect((rejected as Error).cause).toBe(reason);
            expect(parser.closed).toBe(true);
        }
    });
}

test('Web abort normalizes reasons, preserves genuine errors, and cancels without a reason', async () => {
    const foreign = runInNewContext('new Error("other realm")') as Error;
    const original = new Error('failed');
    for (const reason of [
        undefined,
        null,
        false,
        0,
        '',
        'failed',
        { detail: 'failed' },
        original,
        foreign,
    ]) {
        const parser = new JsonParser();
        const value = parser.getValue().catch((error: unknown) => error);
        const writer = parser.writable.getWriter();
        await writer.write('[1,');
        await writer.abort(reason);
        const rejected = await value;
        if (reason === original || reason === foreign) expect(rejected).toBe(reason);
        else {
            expect(rejected).toBeInstanceOf(Error);
            if (reason == null) expect((rejected as Error).name).toBe('AbortError');
            else expect((rejected as Error).cause).toBe(reason);
        }
        expect(parser.closed).toBe(true);
        expect(parser.finished).toBe(false);
    }
});
