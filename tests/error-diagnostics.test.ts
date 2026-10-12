import { expect, test } from '@jest/globals';
import { JsonParser, Json5Parser } from '../src/index';

for (const Parser of [JsonParser, Json5Parser]) {
    test(`${Parser.name}: malformed hex escapes retain their position across every chunk cut`, () => {
        const escapes = ['\\uG123', '\\u1G23', '\\u12G3', '\\u123G'];
        if (Parser === Json5Parser) escapes.push('\\xG1', '\\x1G');
        for (const escaped of escapes) {
            const text = '{"zz":{"a":"' + escaped + '"}}';
            const layouts = [
                (parser: JsonParser | Json5Parser) => parser.onValue('$', () => {}),
                (parser: JsonParser | Json5Parser) => parser.onValue('$.missing', () => {}),
                (parser: JsonParser | Json5Parser) => parser.onString('$.zz.a', () => {}),
            ];
            const chunks = [[text], [...text]];
            for (let first = 1; first < text.length; first++) {
                chunks.push([text.slice(0, first), text.slice(first)]);
                for (let second = first + 1; second < text.length; second++)
                    chunks.push([
                        text.slice(0, first),
                        text.slice(first, second),
                        text.slice(second),
                    ]);
            }
            for (const setup of layouts) {
                for (const parts of chunks) {
                    const parser = new Parser();
                    setup(parser);
                    expect(() => {
                        for (const part of parts) parser.write(part);
                        parser.end();
                    }).toThrow('Json syntax error at ' + text.indexOf('G'));
                }
            }
        }
    });
}
