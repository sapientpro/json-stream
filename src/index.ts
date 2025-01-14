import {Readable, Writable} from 'node:stream';

export class JsonStream extends Writable {
    private readonly values = new Map<string, (value: any) => void>;
    private readonly streams = new Map<string, Readable>;
    private readonly getJson = () => '';

    get json() {
        return this.getJson();
    }

    constructor(start: string = '') {
        let started = false
        if (!start) {
            started = true
        }
        let buffer: string = ''
        let pos: number = 0;
        let contination = Promise.withResolvers<void>();
        let process = Promise.withResolvers<void>();

        const next = async (shift = 0, callback?: () => void,) => {
            while (this.writable && pos + shift >= buffer.length) {
                callback?.();
                const {resolve} = contination;
                contination = Promise.withResolvers<void>();
                resolve();

                await process.promise;
            }

            return this.writable;
        }

        const skipSpaces = async () => {
            while (await next()) {
                if (buffer.at(pos)!.trim() === '') {
                    ++pos;
                    continue;
                }
                break;
            }
        }

        const parse = async (prefix: string = '') => {
            await skipSpaces();
            let value: any;
            switch (buffer.at(pos)) {
                case '{': {
                    pos++;
                    value = {}
                    while (await next()) {
                        await skipSpaces();
                        if (buffer.at(pos) === '}') {
                            ++pos;
                            break;
                        }

                        const name = await parseString(false);

                        await skipSpaces();

                        if (buffer.at(pos) !== ':') {
                            throw new SyntaxError('Json syntax error at ' + pos);
                        }

                        ++pos

                        value[name] = await parse(`${prefix}.${name}`)
                        await skipSpaces();

                        if (buffer.at(pos) === ',') {
                            ++pos;
                        }
                    }
                    break;
                }
                case '[': {
                    ++pos;
                    let index = 0;
                    value = [];
                    while (await next()) {
                        await skipSpaces();
                        if (buffer.at(pos) === ']') {
                            ++pos;
                            break;
                        }
                        value.push(await parse(`${prefix}.${index}`));
                        ++index;
                        await skipSpaces();
                        if(buffer.at(pos) === ',') {
                            ++pos;
                        }
                    }
                    break;
                }
                case '"':
                    value = await parseString(prefix);
                    break;
                case "t":
                    await next(3);
                    if (buffer.substring(pos, pos + 4) !== 'true') {
                        throw new SyntaxError('Json syntax error at ' + pos);
                    }
                    value = true;
                    pos += 4;
                    break;
                case "f":
                    await next(4);
                    if (buffer.substring(pos, pos + 5) !== 'false') {
                        throw new SyntaxError('Json syntax error at ' + pos);
                    }
                    value = false;
                    pos += 5;
                    break;
                case "n":
                    await next(3);
                    if (buffer.substring(pos, pos + 4) !== 'null') {
                        throw new SyntaxError('Json syntax error at ' + pos);
                    }
                    value = null;
                    pos += 4;
                    break;
                default:
                    do {
                        const str = buffer.substring(pos);
                        const match = str.match(/^(-?\d+(\.\d+)?([eE][+-]?\d+)?)([^.eE])?/);
                        if ((this.writable || this.writableLength > 0) && match && match[4] === void 0) {
                            await next(str.length + 1);
                            continue;
                        }

                        if (!match) {
                            throw new SyntaxError('Json syntax error at ' + pos);
                        }

                        value = Number(match[1]);
                        pos += match[1].length;
                    } while (false);
            }

            this.values.get(prefix)?.(value);

            return value;
        }

        const parseString = async (prefix: string | false = false) => {
            let value = '';
            let chunk = '';
            ++pos;
            const stream = prefix ? this.streams.get(prefix) : void 0;
            loop: while (await next(0, () => {
                value += chunk;
                stream?.push(chunk);
                chunk = '';
            })) {
                switch (buffer.at(pos)) {
                    case '"':
                        ++pos;
                        break loop;
                    case '\\':
                        ++pos;
                        await next();
                        switch (buffer.at(pos)) {
                            case 't':
                                chunk += '\t';
                                ++pos;
                                break;
                            case 'r':
                                chunk += '\r';
                                ++pos;
                                break;
                            case 'n':
                                chunk += '\n';
                                ++pos;
                                break;
                            case 'b':
                                chunk += '\b';
                                ++pos;
                                break;
                            case 'f':
                                chunk += '\f';
                                ++pos;
                                break;
                            case 'u':
                                await next(4);
                                chunk += String.fromCharCode(parseInt(buffer.substring(pos + 1, pos + 5), 16));
                                pos += 5;
                                break;
                            default:
                                chunk += buffer.at(pos);
                                ++pos;
                                break;
                        }
                        break;
                    default:
                        chunk += buffer.at(pos)!;
                        ++pos;
                        break;
                }
            }
            if (chunk) {
                value += chunk;
                stream?.push(chunk);
            }
            stream?.push(null);

            return value;
        }
        super({
            defaultEncoding: 'utf-8',
            construct(this: JsonStream, callback: (error?: (Error | null)) => void) {
                skipSpaces()
                    .then(() => {
                        buffer = buffer.substring(pos);
                        pos = 0;
                        return parse();
                    })
                    .then(async (value) => {
                        contination.resolve();
                        this.emit('value', value)
                    })
                    .catch((e) => {
                        this.emit('error', e);
                    });
                callback();
            },
            async write(this: JsonStream, chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: (Error | null)) => void) {
                buffer += chunk.toString('utf-8');
                if (!started) {
                    //cut buffer to start
                    let startCharPos = buffer.indexOf(start?.at(0)!);
                    if (startCharPos > 0) {
                        buffer = buffer.substring(startCharPos);
                    }
                    const startPos = buffer.indexOf(start);
                    if (startPos >= 0) {
                        buffer = buffer.substring(pos + start.length);
                        started = true;
                    } else {
                        callback();
                        return;
                    }
                }
                contination.promise.then(() => {
                    callback()
                });

                const {resolve} = process;
                process = Promise.withResolvers<void>();
                resolve();
            },
            final(this: JsonStream, callback: (error?: (Error | null)) => void) {
                contination.promise.then(() => {
                    callback()
                }, callback)
            },
            destroy(this: JsonStream, error: Error | null, callback: (error?: (Error | null)) => void) {
                this.values.forEach((value) => value(void 0));
                this.streams.forEach((stream) => stream.push(null));
                callback(error);
            }
        });

        this.getJson = () => started ? buffer.substring(0, pos) : '';
    }

    public value<T = any>(name: string = ''): Promise<T> {
        const {promise, resolve} = Promise.withResolvers<T>()
        this.values.set(name && `.${name}`, resolve);
        return promise
    }

    public stream(name: string) {
        const stream = new Readable({
            encoding: 'utf-8',
            read() {
            }
        });

        this.streams.set(`.${name}`, stream);

        return stream;
    }
}