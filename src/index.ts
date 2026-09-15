import {Writable} from 'node:stream';
import {Emitted, JsonParser, Path} from "./parser.js";
import {Observable} from "./subject.js";

export {Any, Rest, JsonParser} from "./parser.js";
export type {Path, PathSegment, Emitted, ParserOptions} from "./parser.js";
export type {Observable, Observer, Subscription} from "./subject.js";

type Callback = (error?: Error | null) => void;

export class JsonStream extends Writable {
  readonly #parser: JsonParser;

  constructor(start: string = '', collectJson: boolean = false) {
    const parser = new JsonParser({start, collectJson});
    super({
      defaultEncoding: 'utf-8',
      decodeStrings: false,
      write: (chunk: Buffer | string, encoding: BufferEncoding, callback: Callback) => {
        try {
          parser.write(typeof chunk === 'string' ? chunk : new Uint8Array(chunk));
          if (parser.finished) this.emit('value', parser.root);
        } catch (e) {
          return callback(e as Error);
        }
        callback();
      },
      final: (callback: Callback) => {
        try {
          const wasFinished = parser.finished;
          parser.end();
          if (!wasFinished) this.emit('value', parser.root);
        } catch (e) {
          return callback(e as Error);
        }
        callback();
      },
      destroy: (error: Error | null, callback: Callback) => {
        parser.destroy(error);
        callback(error);
      }
    });
    this.#parser = parser;
  }

  get json(): string {
    return this.#parser.json;
  }

  public observe<T = any>(path: Path = []): Observable<Emitted<T>> {
    return this.#parser.observe<T>(path);
  }

  public stream(path: Path): ReadableStream<string> {
    return this.#parser.stream(path);
  }

  public value<T = any>(path: Path = []): Promise<T> {
    return this.#parser.value<T>(path);
  }
}
