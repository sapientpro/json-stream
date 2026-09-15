import {firstValue, Observable, Subject, toReadableStream} from "./subject.js";

export const Any = Symbol('Any');
export const Rest = Symbol('Rest');

export type PathSegment = string | number;

export type Path =
  string
  | (PathSegment | typeof Any)[]
  | [...(PathSegment | typeof Any)[], typeof Rest];

export type Emitted<T = any> = { path: PathSegment[], value: T };

export type ParserOptions = {
  start?: string;
  collectJson?: boolean;
  maxDepth?: number;
};

type Node = {
  values?: Subject<Emitted>,
  chunks?: Subject<string>,
  children: {
    [key: string]: Node,
    [Any]?: Node,
    [Rest]?: Node
  },
}

type Frame = { container: any, isArray: boolean, key: string, count: number };

const SEEK = 0, VALUE = 1, OBJ_FIRST = 2, OBJ_KEY = 3, COLON = 4, OBJ_NEXT = 5,
  ARR_NEXT = 6, STR = 7, ESC = 8, UESC = 9, NUM = 10, LIT = 11, END = 12, FAILED = 13;

const QUOTE = 34, BACKSLASH = 92, LBRACE = 123, RBRACE = 125, LBRACKET = 91,
  RBRACKET = 93, COMMA = 44, COLON_CH = 58, MINUS = 45, PLUS = 43, DOT = 46,
  ZERO = 48, NINE = 57, LOWER_E = 101, UPPER_E = 69;

const HEX4 = /^[0-9a-fA-F]{4}$/;
const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

const newNode = (): Node => ({children: Object.create(null)});

const childrenOf = (node: Node): Node[] => {
  const out = Object.values(node.children);
  if (node.children[Any]) out.push(node.children[Any]!);
  if (node.children[Rest]) out.push(node.children[Rest]!);
  return out;
}

const isSpace = (code: number) =>
  code === 32 || code === 10 || code === 13 || code === 9;

/**
 * Incremental JSON parser. Synchronous and transport free: feed it text or
 * bytes, it runs to the end of what it has and returns.
 */
export class JsonParser {
  readonly #root: Node = newNode();
  readonly #start: string;
  readonly #collect: boolean;
  readonly #maxDepth: number;

  #buf = '';
  #pos = 0;
  #consumed = 0;
  #state: number;
  #stack: Frame[] = [];
  #path: PathSegment[] = [];
  #acc = '';
  #str = '';
  #sent = 0;
  #strSink: Subject<string> | null = null;
  #keyMode = false;
  #decoder: InstanceType<typeof TextDecoder> | null = null;
  #json = '';
  #done = false;
  #value: any;
  #failure: Error | null = null;
  #writable: WritableStream<Uint8Array | string> | null = null;

  constructor({start = '', collectJson = false, maxDepth = 1000}: ParserOptions = {}) {
    this.#start = start;
    this.#collect = collectJson;
    this.#maxDepth = maxDepth;
    this.#state = start ? SEEK : VALUE;
  }

  /** Raw text written so far. Empty unless `collectJson` was set. */
  get json(): string {
    return this.#json;
  }

  /** The completed root value, or undefined while parsing. */
  get root(): any {
    return this.#value;
  }

  get finished(): boolean {
    return this.#state === END;
  }

  observe<T = any>(path: Path = []): Observable<Emitted<T>> {
    const node = this.#node(path);
    return (node.values ??= this.#seal(new Subject<Emitted>())) as Subject<Emitted<T>>;
  }

  /** Pieces of the string value at `path`, as they are parsed. */
  chunks(path: Path): Observable<string> {
    const node = this.#node(path);
    return (node.chunks ??= this.#seal(new Subject<string>()));
  }

  /** Sink for `response.body.pipeTo(parser.writable)`. */
  get writable(): WritableStream<Uint8Array | string> {
    return (this.#writable ??= new WritableStream<Uint8Array | string>({
      write: chunk => void this.write(chunk),
      close: () => void this.end(),
      abort: reason => this.destroy(reason instanceof Error ? reason : new Error(String(reason))),
    }));
  }

  /** Same as `chunks`, as a web stream. */
  stream(path: Path): ReadableStream<string> {
    return toReadableStream(this.chunks(path));
  }

  async value<T = any>(path: Path = []): Promise<T> {
    const {value} = await firstValue(this.observe<T>(path));
    return value;
  }

  write(chunk: string | Uint8Array): void {
    if (this.#state === FAILED) throw this.#failure!;

    const text = typeof chunk === 'string'
      ? chunk
      : (this.#decoder ??= new TextDecoder('utf-8')).decode(chunk, {stream: true});

    if (this.#collect) this.#json += text;
    if (this.#state === END) return;

    if (this.#pos) {
      this.#consumed += this.#pos;
      this.#buf = this.#buf.slice(this.#pos) + text;
      this.#pos = 0;
    } else {
      this.#buf += text;
    }

    this.#run();
  }

  end(): void {
    if (this.#state === FAILED) throw this.#failure!;
    if (this.#state === END) return this.#complete();

    if (this.#state === NUM) this.#closeNumber();
    else if (this.#state === LIT) this.#closeLiteral();

    if (this.#state !== END) {
      this.#fail(this.#state === SEEK
        ? new SyntaxError('Start pattern ' + JSON.stringify(this.#start) + ' not found')
        : this.#syntaxError());
    }
    this.#complete();
  }

  /** Errors every observer, as a transport would on an aborted stream. */
  destroy(error?: Error | null): void {
    if (error) this.#fail(error, false);
    else this.#complete();
  }

  #node(path: Path, create: false): Node | null
  #node(path: Path, create?: true): Node
  #node(path: Path, create = true): Node | null {
    const segments = typeof path === 'string' ? path.split('.') : path;
    let node = this.#root;
    for (const key of segments) {
      if (Object.hasOwn(node.children, key)) node = node.children[key]!;
      else if (create) node = node.children[key] = newNode();
      else return null;
    }
    return node;
  }

  /** A path observed after the parse ended must not wait forever. */
  #seal<T>(subject: Subject<T>): Subject<T> {
    if (this.#failure) subject.error(this.#failure);
    else if (this.#done) subject.complete();
    return subject;
  }

  #syntaxError(): SyntaxError {
    return new SyntaxError('Json syntax error at ' + (this.#consumed + this.#pos));
  }

  #fail(error: Error, shouldThrow = true): never | void {
    if (this.#state === FAILED) return;
    this.#state = FAILED;
    this.#failure = error;
    this.#walk(this.#root, node => {
      node.chunks?.error(error);
      node.values?.error(error);
    });
    if (shouldThrow) throw error;
  }

  #complete(): void {
    this.#done = true;
    this.#walk(this.#root, node => {
      node.chunks?.complete();
      node.values?.complete();
    });
  }

  #walk(node: Node, fn: (node: Node) => void): void {
    fn(node);
    for (const child of childrenOf(node)) this.#walk(child, fn);
  }

  #emit(value: any): void {
    this.#dispatch(this.#root, value, 0);

    const frame = this.#stack[this.#stack.length - 1];
    if (!frame) {
      this.#value = value;
      this.#state = END;
      this.#buf = '';
      this.#pos = 0;
      return;
    }
    if (frame.isArray) {
      frame.container.push(value);
      this.#path[this.#path.length - 1] = ++frame.count;
      this.#state = ARR_NEXT;
    } else {
      // __proto__ is an accessor on Object.prototype; assigning would move the
      // prototype instead of creating an own property.
      if (frame.key === '__proto__') {
        Object.defineProperty(frame.container, frame.key,
          {value, enumerable: true, writable: true, configurable: true});
      } else {
        frame.container[frame.key] = value;
      }
      this.#path.pop();
      this.#state = OBJ_NEXT;
    }
  }

  #dispatch(node: Node, value: any, depth: number): void {
    const path = this.#path;
    if (depth === path.length) {
      node.values?.next({path: path.slice(), value});
      return;
    }
    const key = path[depth]!;
    if (Object.hasOwn(node.children, key)) this.#dispatch(node.children[key]!, value, depth + 1);
    if (node.children[Any]) this.#dispatch(node.children[Any]!, value, depth + 1);
    if (node.children[Rest]) this.#dispatch(node.children[Rest]!, value, path.length);
  }

  #open(isArray: boolean): void {
    if (this.#stack.length >= this.#maxDepth) {
      this.#fail(new SyntaxError('Json nesting deeper than ' + this.#maxDepth));
    }
    this.#stack.push({container: isArray ? [] : {}, isArray, key: '', count: 0});
    if (isArray) this.#path.push(0);
    this.#state = isArray ? VALUE : OBJ_FIRST;
  }

  #close(): void {
    const frame = this.#stack.pop()!;
    if (frame.isArray) this.#path.pop();
    this.#emit(frame.container);
  }

  #closeNumber(): void {
    const text = this.#acc;
    this.#acc = '';
    if (!NUMBER.test(text)) this.#fail(this.#syntaxError());
    this.#emit(Number(text));
  }

  #closeLiteral(): void {
    const text = this.#acc;
    this.#acc = '';
    if (text === 'true') this.#emit(true);
    else if (text === 'false') this.#emit(false);
    else if (text === 'null') this.#emit(null);
    else this.#fail(this.#syntaxError());
  }

  #closeString(): void {
    this.#flushChunk(true);
    const text = this.#str;
    this.#str = '';
    this.#sent = 0;
    if (this.#keyMode) {
      this.#stack[this.#stack.length - 1]!.key = text;
      this.#path.push(text);
      this.#state = COLON;
      return;
    }
    if (this.#strSink) {
      this.#strSink.complete();
      this.#strSink = null;
    }
    this.#emit(text);
  }

  #run(): void {
    const buf = this.#buf;
    const len = buf.length;
    let pos = this.#pos;

    for (; ;) {
      switch (this.#state) {
        case END:
        case FAILED:
          this.#pos = pos;
          return;

        case SEEK: {
          const found = buf.indexOf(this.#start, pos);
          if (found < 0) {
            this.#pos = Math.max(pos, len - this.#start.length + 1);
            return;
          }
          pos = found + this.#start.length;
          this.#consumed = -pos;
          this.#state = VALUE;
          break;
        }

        case VALUE:
        case OBJ_FIRST:
        case OBJ_KEY:
        case COLON:
        case OBJ_NEXT:
        case ARR_NEXT: {
          while (pos < len && isSpace(buf.charCodeAt(pos))) ++pos;
          if (pos >= len) {
            this.#pos = pos;
            return;
          }
          const code = buf.charCodeAt(pos);
          switch (this.#state) {
            case VALUE:
              if (code === LBRACE) {
                ++pos;
                this.#open(false);
              } else if (code === LBRACKET) {
                ++pos;
                this.#open(true);
              } else if (code === RBRACKET && this.#stack[this.#stack.length - 1]?.isArray) {
                ++pos;
                this.#close();
              } else if (code === QUOTE) {
                ++pos;
                this.#keyMode = false;
                this.#strSink = this.#node(this.#path, false)?.chunks ?? null;
                this.#state = STR;
              } else if ((code >= ZERO && code <= NINE) || code === MINUS) {
                this.#acc = '';
                this.#state = NUM;
              } else {
                this.#acc = '';
                this.#state = LIT;
              }
              break;
            case OBJ_FIRST:
            case OBJ_KEY:
              // a trailing comma leaves OBJ_KEY facing the closing brace
              if (code === RBRACE) {
                ++pos;
                this.#close();
                break;
              }
              if (code !== QUOTE) {
                this.#pos = pos;
                this.#fail(this.#syntaxError());
              }
              ++pos;
              this.#keyMode = true;
              this.#strSink = null;
              this.#state = STR;
              break;
            case COLON:
              if (code !== COLON_CH) {
                this.#pos = pos;
                this.#fail(this.#syntaxError());
              }
              ++pos;
              this.#state = VALUE;
              break;
            // a missing separator is tolerated, as it was before
            case OBJ_NEXT:
              if (code === COMMA) ++pos;
              if (buf.charCodeAt(pos) === RBRACE) {
                ++pos;
                this.#close();
              } else {
                this.#state = OBJ_KEY;
              }
              break;
            case ARR_NEXT:
              if (code === COMMA) ++pos;
              this.#state = VALUE;
              break;
          }
          break;
        }

        case STR: {
          let end = pos;
          while (end < len) {
            const code = buf.charCodeAt(end);
            if (code === QUOTE || code === BACKSLASH) break;
            ++end;
          }
          if (end > pos) {
            this.#str += buf.slice(pos, end);
            pos = end;
          }
          if (pos >= len) {
            this.#flushChunk();
            this.#pos = pos;
            return;
          }
          if (buf.charCodeAt(pos) === QUOTE) {
            ++pos;
            this.#pos = pos;
            this.#closeString();
          } else {
            ++pos;
            this.#state = ESC;
          }
          break;
        }

        case ESC: {
          if (pos >= len) {
            this.#pos = pos;
            return;
          }
          const ch = buf[pos]!;
          if (ch === 'u') {
            ++pos;
            this.#acc = '';
            this.#state = UESC;
            break;
          }
          this.#str += ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r'
            : ch === 'b' ? '\b' : ch === 'f' ? '\f' : ch;
          ++pos;
          this.#state = STR;
          break;
        }

        case UESC: {
          const take = Math.min(4 - this.#acc.length, len - pos);
          this.#acc += buf.slice(pos, pos + take);
          pos += take;
          if (this.#acc.length < 4) {
            this.#pos = pos;
            return;
          }
          if (!HEX4.test(this.#acc)) {
            this.#pos = pos;
            this.#fail(this.#syntaxError());
          }
          this.#str += String.fromCharCode(parseInt(this.#acc, 16));
          this.#acc = '';
          this.#state = STR;
          break;
        }

        case NUM: {
          let end = pos;
          while (end < len) {
            const code = buf.charCodeAt(end);
            if ((code >= ZERO && code <= NINE) || code === MINUS || code === PLUS
              || code === DOT || code === LOWER_E || code === UPPER_E) ++end;
            else break;
          }
          if (end > pos) {
            this.#acc += buf.slice(pos, end);
            pos = end;
          }
          if (pos >= len) {
            this.#pos = pos;
            return;
          }
          this.#pos = pos;
          this.#closeNumber();
          break;
        }

        case LIT: {
          let end = pos;
          while (end < len && buf.charCodeAt(end) >= 97 && buf.charCodeAt(end) <= 122) ++end;
          if (end > pos) {
            this.#acc += buf.slice(pos, end);
            pos = end;
          }
          if (pos >= len) {
            this.#pos = pos;
            return;
          }
          this.#pos = pos;
          this.#closeLiteral();
          break;
        }
      }
    }
  }

  #flushChunk(final = false): void {
    if (!this.#strSink) return;
    let end = this.#str.length;
    // a chunk must not end mid surrogate pair: encoded alone the half becomes U+FFFD
    if (!final && end > this.#sent) {
      const last = this.#str.charCodeAt(end - 1);
      if (last >= 0xD800 && last <= 0xDBFF) --end;
    }
    if (end <= this.#sent) return;
    this.#strSink.next(this.#str.slice(this.#sent, end));
    this.#sent = end;
  }
}
