declare namespace NodeJS {
  interface ProcessEnv { [key: string]: string | undefined; }
}
declare const process: {
  env: NodeJS.ProcessEnv;
  version: string;
  argv: string[];
  exitCode?: number;
  stdin: { isTTY?: boolean; pause(): void };
  stdout: { isTTY?: boolean; write(value: string): void };
};
declare const Buffer: {
  from(value: string | ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  concat(values: readonly Uint8Array[]): Buffer;
  alloc(size: number): Buffer;
  byteLength(value: string): number;
};
declare class Buffer extends Uint8Array {
  toString(encoding?: string): string;
  toJSON(): { type: "Buffer"; data: number[] };
}
declare module "node:http" {
  import { EventEmitter } from "node:events";
  export interface IncomingHttpHeaders { [key: string]: string | string[] | undefined; }
  export interface IncomingMessage extends EventEmitter {
    method?: string;
    url?: string;
    headers: IncomingHttpHeaders;
    destroy(): void;
    on(event: string, listener: (...args: never[]) => void): this;
    [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array>;
  }
  export interface ServerResponse extends EventEmitter {
    statusCode: number;
    setHeader(name: string, value: string): void;
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    flushHeaders(): void;
    end(body?: string | Uint8Array): void;
  }
  export interface Server extends EventEmitter {
    listen(port: number, hostname?: string, callback?: () => void): this;
    close(callback?: (error?: Error) => void): this;
    address(): { port: number } | string | null;
  }
  export function createServer(listener: (request: IncomingMessage, response: ServerResponse) => void): Server;
}
declare module "node:crypto" {
  export interface KeyObject { export(options: { type: "spki"; format: "pem" | "der" | "jwk" }): string | Buffer | Uint8Array | JsonWebKey; }
  export function randomBytes(size: number): Buffer;
  export function randomUUID(): string;
  export interface JsonWebKey { kty: string; x?: string; crv?: string; d?: string; }
  export function createHash(algorithm: string): { update(data: string | Uint8Array): { digest(encoding: "hex"): string; digest(): Buffer } };
  export function createHmac(algorithm: string, key: Uint8Array): { update(data: string | Uint8Array): { digest(): Buffer } };
  export function generateKeyPairSync(type: string): { publicKey: KeyObject; privateKey: KeyObject };
  export function createPublicKey(options: { key: JsonWebKey; format: "jwk" } | { key: string; format: "pem" } | { key: Uint8Array; format: "der"; type: "spki" } | KeyObject): KeyObject;
  export function createPrivateKey(options: { key: JsonWebKey; format: "jwk" } | { key: string; format: "pem" }): KeyObject;
  export type SignKey = KeyObject | { key: KeyObject; dsaEncoding?: string };
  export function sign(algorithm: string | null, data: Uint8Array, key: SignKey): Buffer;
  export function verify(algorithm: string | null, data: Uint8Array, key: SignKey, signature: Uint8Array): boolean;
  export class X509Certificate {
    constructor(cert: string | Uint8Array);
    readonly subject: string;
    readonly issuer: string;
    readonly validFrom: string;
    readonly validTo: string;
    readonly raw: Uint8Array;
    readonly publicKey: KeyObject;
    verify(key: KeyObject): boolean;
    checkIssued(issuer: X509Certificate): boolean;
  }
  export function diffieHellman(options: { privateKey: KeyObject; publicKey: KeyObject }): Buffer;
  export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array): {
    setAAD(data: Uint8Array): void;
    update(data: Uint8Array): Buffer;
    final(): Buffer;
    getAuthTag(): Buffer;
  };
  export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array): {
    setAAD(data: Uint8Array): void;
    setAuthTag(tag: Uint8Array): void;
    update(data: Uint8Array): Buffer;
    final(): Buffer;
  };
  export function hkdfSync(digest: string, key: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): ArrayBuffer;
}
declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
}
declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}
declare module "node:events" { export class EventEmitter { on(event: string, listener: (...args: never[]) => void): this; once(event: string, listener: (...args: never[]) => void): this; removeListener(event: string, listener: (...args: never[]) => void): this; emit(event: string, ...args: never[]): boolean; } }
declare module "node:worker_threads" {
  import { EventEmitter } from "node:events";
  export class Worker extends EventEmitter {
    constructor(filename: string | URL, options?: { type?: "module" | "commonjs" }): Worker;
    postMessage(value: unknown): void;
    terminate(): Promise<number>;
    unref(): void;
  }
  export const parentPort: (EventEmitter & { on(event: "message", listener: (value: unknown) => void): EventEmitter; postMessage(value: unknown): void }) | null;
}
declare module "node:url" { export function fileURLToPath(url: string | URL): string; }
declare module "node:readline" {
  interface Interface { question(query: string, cb: (answer: string) => void): void; close(): void; on(event: "close", cb: () => void): void; }
  export function createInterface(options: { input: unknown; output: unknown }): Interface;
}
declare module "node:module" { export function createRequire(url: string | URL): (specifier: string) => { isMainThread?: boolean }; }
declare module "node:fs/promises" {
  export function readFile(path: string | URL, options: "utf8"): Promise<string>;
  export function readFile(path: string | URL, options: { encoding: "utf8" }): Promise<string>;
  export function readFile(path: string | URL, options?: { encoding?: string }): Promise<Uint8Array>;
}
declare module "node:assert/strict" { const assert: { equal(actual: unknown, expected: unknown, message?: string): void; notEqual(actual: unknown, expected: unknown, message?: string): void; deepEqual(actual: unknown, expected: unknown, message?: string): void; ok(value: unknown, message?: string): void; rejects(fn: () => Promise<unknown>, message?: string): Promise<void>; throws(fn: () => unknown, expected?: string | RegExp): void }; export default assert; }
declare module "node:test" { type TestFn = (name: string, fn: () => void | Promise<void>) => void | Promise<void>; const test: TestFn; export function after(fn: () => void | Promise<void>): void; export default test; }
