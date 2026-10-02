import {firstValue, Observable, Subject, SubjectOptions, toReadableStream, validateBufferLimit} from "./subject.js";

export const Any = Symbol('Any');
export const Rest = Symbol('Rest');

export type PathSegment = string | number;

export type Path =
  string
  | (PathSegment | typeof Any)[]
  | [...(PathSegment | typeof Any)[], typeof Rest];

export type Emitted<T = any> = { path: PathSegment[], value: T };

export type ParserOptions = SubjectOptions & {
  start?: string;
  collectJson?: boolean;
  maxDepth?: number;
  /** Keep the complete root tree. When false, retain only observed values. */
  retainRoot?: boolean;
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

// Use the native scanner only after a short prefix; tiny strings need no match allocation.
const STRING_END = /["\\]/g;
const HEX4 = /^[0-9a-fA-F]{4}$/;

const hexDigit = (code: number): number => {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
};

const readHex4 = (buf: string, pos: number): number => {
  const a = hexDigit(buf.charCodeAt(pos)), b = hexDigit(buf.charCodeAt(pos + 1));
  const c = hexDigit(buf.charCodeAt(pos + 2)), d = hexDigit(buf.charCodeAt(pos + 3));
  return (a | b | c | d) < 0 ? -1 : (a << 12) | (b << 8) | (c << 4) | d;
};

// Returns 1/2/3 for true/false/null, or 0 for the incremental path.
const readLiteral = (buf: string, pos: number, len: number): number => {
  const first = buf.charCodeAt(pos);
  let literal = 0;
  if (first === 116 && buf.charCodeAt(pos + 1) === 114 && buf.charCodeAt(pos + 2) === 117 && buf.charCodeAt(pos + 3) === 101) literal = 1;
  else if (first === 102 && buf.charCodeAt(pos + 1) === 97 && buf.charCodeAt(pos + 2) === 108 && buf.charCodeAt(pos + 3) === 115 && buf.charCodeAt(pos + 4) === 101) literal = 2;
  else if (first === 110 && buf.charCodeAt(pos + 1) === 117 && buf.charCodeAt(pos + 2) === 108 && buf.charCodeAt(pos + 3) === 108) literal = 3;
  if (!literal) return 0;
  const end = pos + (literal === 2 ? 5 : 4);
  // A token at the chunk boundary must wait for continuation or end().
  if (end >= len) return 0;
  const next = buf.charCodeAt(end);
  return next >= 97 && next <= 122 ? 0 : literal;
};

const newNode = (): Node => ({children: Object.create(null)});

const childrenOf = (node: Node): Node[] => {
  const out = Object.values(node.children);
  if (node.children[Any]) out.push(node.children[Any]!);
  if (node.children[Rest]) out.push(node.children[Rest]!);
  return out;
}

const isSpace = (code: number) =>
  code === 32 || code === 10 || code === 13 || code === 9;

// Keep the string scanner outside the state-machine loop.
const scanStringEnd = (buf: string, pos: number, len: number): number => {
  let end = pos;
  const scanEnd = Math.min(len, pos + 32);
  while (end < scanEnd) {
    const code = buf.charCodeAt(end);
    if (code === QUOTE || code === BACKSLASH) return end;
    ++end;
  }
  if (end < len) {
    STRING_END.lastIndex = end;
    return STRING_END.exec(buf)?.index ?? len;
  }
  return end;
};

/**
 * Incremental JSON parser. Synchronous and transport free: feed it text or
 * bytes, it runs to the end of what it has and returns.
 */
export class JsonParser {
  readonly #root: Node = newNode();
  readonly #start: string;
  readonly #collect: boolean;
  readonly #maxDepth: number;
  readonly #retainRoot: boolean;
  readonly #subjectOptions: SubjectOptions;
  #started = false;

  #buf = '';
  #pinned = 0;
  #snapshot: PathSegment[] | null = null;
  #pos = 0;
  #consumed = 0;
  #state: number;
  #stack: Frame[] = [];
  #path: PathSegment[] = [];
  #acc = '';
  // Numeric phases: required integer, integer, required fraction, fraction,
  // optional exponent sign, required exponent, exponent, malformed.
  #numPhase = 0;
  #str = '';
  #parts: string[] | null = null;
  #hasChunks = false;
  #retainString = true;
  #strSinks: {subject: Subject<string>, wildcard: boolean}[] = [];
  #keyMode = false;
  #decoder: InstanceType<typeof TextDecoder> | null = null;
  #json = '';
  #done = false;
  #value: any;
  #failure: Error | null = null;
  #writable: WritableStream<Uint8Array | string> | null = null;
  #running = false;

  constructor({start = '', collectJson = false, maxDepth = 1000, retainRoot = true,
    maxBufferedChunks = Infinity, onObserverError}: ParserOptions = {}) {
    validateBufferLimit(maxBufferedChunks);
    this.#retainRoot = retainRoot;
    this.#subjectOptions = {maxBufferedChunks, onObserverError};
    this.#start = start;
    this.#collect = collectJson;
    this.#maxDepth = maxDepth;
    this.#state = start ? SEEK : VALUE;
  }

  /** Raw text written so far. Empty unless `collectJson` was set. */
  get json(): string {
    return this.#json;
  }

  /** The completed root value, or undefined while parsing / with retainRoot disabled. */
  get root(): any {
    return this.#value;
  }

  get finished(): boolean {
    return this.#state === END;
  }

  observe<T = any>(path: Path = []): Observable<Emitted<T>> {
    if (!this.#retainRoot && this.#started && !this.#done && !this.#failure) {
      throw new Error('Register value observers before writing when retainRoot is false');
    }
    const node = this.#node(path);
    return (node.values ??= this.#seal(new Subject<Emitted>(this.#subjectOptions))) as Subject<Emitted<T>>;
  }

  /** Pieces of the string value at `path`, as they are parsed. */
  chunks(path: Path): Observable<string> {
    this.#hasChunks = true;
    const node = this.#node(path);
    return (node.chunks ??= this.#seal(new Subject<string>(this.#subjectOptions)));
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
    return toReadableStream(this.chunks(path), this.#subjectOptions.maxBufferedChunks);
  }

  async value<T = any>(path: Path = []): Promise<T> {
    const {value} = await firstValue(this.observe<T>(path));
    return value;
  }

  write(chunk: string | Uint8Array): void {
    if (this.#running) throw new Error('write() re-entered from an observer callback; use destroy() to stop');
    if (this.#state === FAILED) throw this.#failure!;
    this.#started = true;

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
    this.#pinned = 0;

    this.#running = true;
    try {
      this.#run();
    } finally {
      this.#running = false;
    }
  }

  end(): void {
    if (this.#running) throw new Error('end() re-entered from an observer callback; use destroy() to stop');
    if (this.#state === FAILED) throw this.#failure!;
    if (this.#state === END) return this.#complete();

    this.#running = true;
    try {
      if (this.#state === NUM) this.#closeNumber();
      else if (this.#state === LIT) this.#closeLiteral();
    } finally {
      this.#running = false;
    }

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

  #node(path: Path): Node {
    const segments = typeof path === 'string' ? path.split('.') : path;
    let node = this.#root;
    for (const key of segments) {
      node = node.children[key] ??= newNode();
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
    this.#snapshot = null;
    this.#dispatch(this.#root, value, 0);
    // an observer may have called destroy(); do not overwrite the terminal state
    if (this.#state === FAILED) return;

    const frame = this.#stack[this.#stack.length - 1];
    if (!frame) {
      if (this.#retainRoot) this.#value = value;
      this.#state = END;
      this.#buf = '';
      this.#pos = 0;
      return;
    }
    if (frame.isArray) {
      frame.container?.push(value);
      this.#path[this.#path.length - 1] = ++frame.count;
      this.#state = ARR_NEXT;
    } else {
      // __proto__ is an accessor on Object.prototype; assigning would move the
      // prototype instead of creating an own property.
      if (frame.container !== undefined && frame.key === '__proto__') {
        Object.defineProperty(frame.container, frame.key,
          {value, enumerable: true, writable: true, configurable: true});
      } else if (frame.container !== undefined) {
        frame.container[frame.key] = value;
      }
      this.#path.pop();
      this.#state = OBJ_NEXT;
    }
  }

  #dispatch(node: Node, value: any, depth: number): void {
    const path = this.#path;
    if (depth === path.length) {
      node.values?.next({path: this.#snapshot ??= path.slice(), value});
      return;
    }
    const key = path[depth]!;
    const exact = node.children[key];
    if (exact) this.#dispatch(exact, value, depth + 1);
    if (node.children[Any]) this.#dispatch(node.children[Any]!, value, depth + 1);
    if (node.children[Rest]) this.#dispatch(node.children[Rest]!, value, path.length);
  }

  #findChunkSinks(node: Node, depth: number, wildcard = false): void {
    if (depth === this.#path.length) {
      if (node.chunks && !node.chunks.closed) this.#strSinks.push({subject: node.chunks, wildcard});
      return;
    }
    const key = this.#path[depth]!;
    const exact = node.children[key];
    if (exact) this.#findChunkSinks(exact, depth + 1, wildcard);
    if (node.children[Any]) this.#findChunkSinks(node.children[Any]!, depth + 1, true);
    if (node.children[Rest]) this.#findChunkSinks(node.children[Rest]!, this.#path.length, true);
  }

  #hasValueSink(node: Node, depth: number): boolean {
    if (depth === this.#path.length) return !!node.values;
    const exact = node.children[this.#path[depth]!];
    if (exact && this.#hasValueSink(exact, depth + 1)) return true;
    const any = node.children[Any];
    if (any && this.#hasValueSink(any, depth + 1)) return true;
    return !!node.children[Rest]?.values;
  }

  #shouldRetain(): boolean {
    if (this.#retainRoot || this.#stack[this.#stack.length - 1]?.container !== undefined) return true;
    return this.#hasValueSink(this.#root, 0);
  }

  #open(isArray: boolean): void {
    if (this.#stack.length >= this.#maxDepth) {
      this.#fail(new SyntaxError('Json nesting deeper than ' + this.#maxDepth));
    }
    const container = this.#shouldRetain() ? (isArray ? [] : {}) : undefined;
    this.#stack.push({container, isArray, key: '', count: 0});
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
    const phase = this.#numPhase;
    this.#numPhase = 0;
    if (phase !== 1 && phase !== 3 && phase !== 6) this.#fail(this.#syntaxError());
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
    let text: string | undefined;
    if (this.#strSinks.length) {
      this.#flushChunk(true);
      text = this.#retainString ? this.#parts?.join('') ?? '' : undefined;
      this.#parts = null;
      for (const {subject, wildcard} of this.#strSinks) {
        if (!wildcard) subject.complete();
      }
      this.#strSinks.length = 0;
    } else {
      // Keys and ordinary values need no fragment array or final join.
      text = this.#retainString ? this.#flatten(this.#str) : undefined;
    }
    this.#str = '';
    if (this.#keyMode) {
      this.#stack[this.#stack.length - 1]!.key = text!;
      this.#path.push(text!);
      this.#state = COLON;
      return;
    }
    this.#emit(text);
  }

  #scanString(buf: string, pos: number, len: number): number {
    let str = this.#str;
    const retain = this.#retainString || this.#strSinks.length > 0;
    for (;;) {
      const end = scanStringEnd(buf, pos, len);
      if (retain && end > pos) str += buf.slice(pos, end);
      pos = end;
      if (pos >= len) {
        this.#str = str; this.#flushChunk(); this.#pos = pos;
        return pos;
      }
      if (buf.charCodeAt(pos) === QUOTE) {
        ++pos; this.#pos = pos; this.#str = str; this.#closeString();
        return pos;
      }
      ++pos; this.#state = ESC;
      if (pos >= len) {
        this.#str = str; this.#flushChunk(); this.#pos = pos;
        return pos;
      }
      const ch = buf[pos]!;
      if (ch === 'u') {
        if (pos + 5 > len) {
          // The caller resumes UESC in this same write when hex digits remain.
          ++pos; this.#acc = ''; this.#state = UESC; this.#str = str; if (pos >= len) this.#flushChunk(); this.#pos = pos;
          return pos;
        }
        const value = readHex4(buf, pos + 1);
        pos += 5;
        if (value < 0) {
          this.#str = str; this.#pos = pos; this.#fail(this.#syntaxError());
        }
        if (retain) str += String.fromCharCode(value);
      } else {
        if (retain) str += ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r'
          : ch === 'b' ? '\b' : ch === 'f' ? '\f' : ch;
        ++pos;
      }
      this.#state = STR;
    }
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
                this.#retainString = this.#retainRoot || this.#shouldRetain();
                if (this.#hasChunks) this.#findChunkSinks(this.#root, 0);
                this.#state = STR;
              } else if ((code >= ZERO && code <= NINE) || code === MINUS) {
                const start = pos, negative = code === MINUS;
                let finish = pos + (negative ? 1 : 0), digits = 0, integer = 0;
                while (finish < len && digits < 8) {
                  const digit = buf.charCodeAt(finish);
                  if (digit < ZERO || digit > NINE) break;
                  integer = integer * 10 + digit - ZERO;
                  ++finish; ++digits;
                }
                let next = buf.charCodeAt(finish);
                if (digits && finish < len && (next === COMMA || next === RBRACE || next === RBRACKET || isSpace(next))) {
                  pos = finish; this.#pos = pos; this.#acc = '';
                  this.#emit(negative ? -integer : integer);
                  break;
                }
                // Grammar transitions occur between runs, never on each digit.
                while (finish < len) {
                  const digit = buf.charCodeAt(finish);
                  if (digit < ZERO || digit > NINE) break;
                  ++finish; ++digits;
                }
                let valid = digits > 0;
                let phase = valid ? 1 : 0;
                next = buf.charCodeAt(finish);
                if (valid && next === DOT) {
                  const fractionStart = ++finish;
                  phase = 2;
                  while (finish < len) {
                    const digit = buf.charCodeAt(finish);
                    if (digit < ZERO || digit > NINE) break;
                    ++finish;
                  }
                  valid = finish > fractionStart;
                  if (valid) phase = 3;
                  next = buf.charCodeAt(finish);
                }
                if (valid && (next === LOWER_E || next === UPPER_E)) {
                  ++finish;
                  phase = 4;
                  const sign = buf.charCodeAt(finish);
                  if (sign === PLUS || sign === MINUS) { ++finish; phase = 5; }
                  const exponentStart = finish;
                  while (finish < len) {
                    const digit = buf.charCodeAt(finish);
                    if (digit < ZERO || digit > NINE) break;
                    ++finish;
                  }
                  valid = finish > exponentStart;
                  if (valid) phase = 6;
                  next = buf.charCodeAt(finish);
                }
                if (valid && finish < len && (next === COMMA || next === RBRACE || next === RBRACKET || isSpace(next))) {
                  pos = finish; this.#pos = pos; this.#acc = '';
                  this.#emit(Number(buf.slice(start, finish)));
                  break;
                }
                this.#acc = buf.slice(start, finish); this.#numPhase = phase; pos = finish; this.#state = NUM;
              } else {
                this.#acc = '';
                const literal = pos + 4 < len ? readLiteral(buf, pos, len) : 0;
                if (literal) {
                  pos += literal === 2 ? 5 : 4;
                  this.#pos = pos;
                  this.#emit(literal === 1 ? true : literal === 2 ? false : null);
                } else {
                  this.#state = LIT;
                }
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
              this.#retainString = true;
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
          const end = scanStringEnd(buf, pos, len);
          if (end > pos) {
            if (this.#retainString || this.#strSinks.length) this.#str += buf.slice(pos, end);
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
            pos = this.#scanString(buf, pos, len);
            if (pos >= len) return;
          }
          break;
        }

        case ESC: {
          if (pos >= len) {
            this.#flushChunk();
            this.#pos = pos;
            return;
          }
          const ch = buf[pos]!;
          if (ch === 'u') {
            if (pos + 5 <= len) {
              const value = readHex4(buf, pos + 1);
              pos += 5;
              if (value < 0) {
                this.#pos = pos;
                this.#fail(this.#syntaxError());
              }
              if (this.#retainString || this.#strSinks.length) this.#str += String.fromCharCode(value);
              this.#state = STR;
              break;
            }
            ++pos;
            this.#acc = '';
            this.#state = UESC;
            break;
          }
          if (this.#retainString || this.#strSinks.length) {
            this.#str += ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r'
              : ch === 'b' ? '\b' : ch === 'f' ? '\f' : ch;
          }
          ++pos;
          this.#state = STR;
          break;
        }

        case UESC: {
          const take = Math.min(4 - this.#acc.length, len - pos);
          this.#acc += buf.slice(pos, pos + take);
          pos += take;
          if (this.#acc.length < 4) {
            this.#flushChunk();
            this.#pos = pos;
            return;
          }
          if (!HEX4.test(this.#acc)) {
            this.#pos = pos;
            this.#fail(this.#syntaxError());
          }
          if (this.#retainString || this.#strSinks.length) {
            this.#str += String.fromCharCode(parseInt(this.#acc, 16));
          }
          this.#acc = '';
          this.#state = STR;
          break;
        }

        case NUM: {
          let end = pos, phase = this.#numPhase;
          while (end < len) {
            const code = buf.charCodeAt(end);
            if (phase !== 7 && code >= ZERO && code <= NINE) {
              // One grammar transition per digit run, not per digit.
              if (phase === 0) phase = 1;
              else if (phase === 2) phase = 3;
              else if (phase === 4 || phase === 5) phase = 6;
              do {
                ++end;
                if (end >= len) break;
                const digit = buf.charCodeAt(end);
                if (digit < ZERO || digit > NINE) break;
              } while (true);
              continue;
            }
            if (phase === 1 && code === DOT) phase = 2;
            else if ((phase === 1 || phase === 3) && (code === LOWER_E || code === UPPER_E)) phase = 4;
            else if (phase === 4 && (code === PLUS || code === MINUS)) phase = 5;
            else if (code === MINUS || code === PLUS || code === DOT || code === LOWER_E || code === UPPER_E || (code >= ZERO && code <= NINE)) phase = 7;
            else break;
            ++end;
          }
          this.#numPhase = phase;
          if (end > pos) { this.#acc += buf.slice(pos, end); pos = end; }
          this.#pos = pos;
          if (pos >= len) return;
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

  /**
   * V8 makes a slice of 13 chars or more a SlicedString that pins the whole
   * write buffer, so a short retained value can hold megabytes alive. Copying
   * is only worth it while little of this buffer is retained: once a quarter
   * of it is, pinning wastes at most 4x what the consumer keeps anyway.
   */
  #flatten(text: string): string {
    if (text.length < 13 || this.#buf.length - text.length <= 1024) return text;
    const copy = this.#pinned * 4 < this.#buf.length;
    this.#pinned += text.length;
    return copy ? (' ' + text).slice(1) : text;
  }

  #flushChunk(final = false): void {
    if (!this.#strSinks.length) {
      if (!this.#retainString) this.#str = '';
      return;
    }
    let end = this.#str.length;
    // Retain only a trailing high surrogate until its partner arrives.
    if (!final && end) {
      const last = this.#str.charCodeAt(end - 1);
      if (last >= 0xD800 && last <= 0xDBFF) --end;
    }
    if (!end) return;
    const chunk = this.#str.slice(0, end);
    this.#str = this.#str.slice(end);
    if (this.#retainString) (this.#parts ??= []).push(chunk);
    for (const {subject} of this.#strSinks) subject.next(chunk);
  }
}
