declare namespace NodeJS {
  interface ProcessEnv { [key: string]: string | undefined; }
}
declare const process: {
  env: NodeJS.ProcessEnv;
  argv: string[];
  exitCode?: number;
  stdout: { write(value: string): void };
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
  export function createPublicKey(options: { key: JsonWebKey; format: "jwk" } | { key: string; format: "pem" }): KeyObject;
  export function createPrivateKey(options: { key: JsonWebKey; format: "jwk" }): KeyObject;
  export function sign(algorithm: null, data: Uint8Array, key: KeyObject): Buffer;
  export function verify(algorithm: null, data: Uint8Array, key: KeyObject, signature: Uint8Array): boolean;
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
declare module "node:events" { export class EventEmitter { on(event: string, listener: (...args: never[]) => void): this; once(event: string, listener: (...args: never[]) => void): this; removeListener(event: string, listener: (...args: never[]) => void): this; emit(event: string, ...args: never[]): boolean; } }
declare module "node:fs/promises" {
  export function readFile(path: string | URL, options: "utf8"): Promise<string>;
  export function readFile(path: string | URL, options: { encoding: "utf8" }): Promise<string>;
  export function readFile(path: string | URL, options?: { encoding?: string }): Promise<Uint8Array>;
}
declare module "node:assert/strict" { const assert: { equal(actual: unknown, expected: unknown, message?: string): void; notEqual(actual: unknown, expected: unknown, message?: string): void; deepEqual(actual: unknown, expected: unknown, message?: string): void; ok(value: unknown, message?: string): void; rejects(fn: () => Promise<unknown>, message?: string): Promise<void>; throws(fn: () => unknown, message?: string): void }; export default assert; }
declare module "node:test" { type TestFn = (name: string, fn: () => void | Promise<void>) => void | Promise<void>; const test: TestFn; export default test; }
