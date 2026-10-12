import { expect, test } from '@jest/globals';
import { JsonParser, Json5Parser, JsonLinesParser, PrefixedJsonParser } from '../src/index';

const factories = [
    () => new JsonParser(),
    () => new Json5Parser(),
    () => new JsonLinesParser(),
    () => new PrefixedJsonParser('data:'),
];

for (const [index, make] of factories.entries()) {
    test(`getValue factory ${index}: catching write failure also handles an ignored value promise`, async () => {
        const parser = make();
        const result = parser.getValue();
        let failure: unknown;
        try {
            parser.write((index === 3 ? 'data:' : '') + '[}\n');
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(SyntaxError);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(result).rejects.toBe(failure);
    });
    test(`getValue factory ${index}: an initially ignored rejection remains observable later`, async () => {
        const parser = make();
        const result = parser.getValue();
        const error = new Error('upstream failed');
        parser.destroy(error);
        // Let an unhandled rejection surface before attaching the consumer handler.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(result).rejects.toBe(error);
    });
    test(`getValue factory ${index}: missing values still reject after a delayed handler`, async () => {
        const parser = make();
        const result = parser.getValue('$.missing');
        parser.write((index === 3 ? 'data:' : '') + '{}\n');
        parser.end();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(result).rejects.toThrow('No value matched the selector');
    });
}
