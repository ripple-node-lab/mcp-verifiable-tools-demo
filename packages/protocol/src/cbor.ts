// Minimal CBOR (RFC 8949) subset: definite lengths only, no floats.
export type CborValue = number | string | boolean | null | undefined | Uint8Array | CborValue[] | Map<CborValue, CborValue> | CborTag;
export class CborTag {
  constructor(readonly tag: number, readonly value: CborValue) {}
}
const MAX_DEPTH = 32;
const MAX_SAFE = 0x1fffffffffffff;

function head(major: number, value: number): Uint8Array {
  const prefix = major << 5;
  if (value < 24) return new Uint8Array([prefix | value]);
  if (value < 0x100) return new Uint8Array([prefix | 24, value]);
  if (value < 0x10000) return new Uint8Array([prefix | 25, value >>> 8, value & 0xff]);
  if (value < 0x100000000) return new Uint8Array([prefix | 26, value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
  const bytes = new Uint8Array(9);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, prefix | 27);
  view.setBigUint64(1, BigInt(value));
  return bytes;
}

export function cborEncode(value: CborValue): Uint8Array {
  const parts: Uint8Array[] = [];
  write(value, parts, 0);
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function write(value: CborValue, parts: Uint8Array[], depth: number): void {
  if (depth > MAX_DEPTH) throw new Error("cbor: depth limit exceeded");
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("cbor: integer out of range");
    parts.push(value >= 0 ? head(0, value) : head(1, -1 - value));
  } else if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    parts.push(head(3, bytes.length), bytes);
  } else if (value instanceof Uint8Array) {
    parts.push(head(2, value.length), value);
  } else if (Array.isArray(value)) {
    parts.push(head(4, value.length));
    for (const item of value) write(item, parts, depth + 1);
  } else if (value instanceof Map) {
    parts.push(head(5, value.size));
    for (const [key, item] of value) { write(key, parts, depth + 1); write(item, parts, depth + 1); }
  } else if (value instanceof CborTag) {
    parts.push(head(6, value.tag));
    write(value.value, parts, depth + 1);
  } else if (value === false) parts.push(new Uint8Array([0xf4]));
  else if (value === true) parts.push(new Uint8Array([0xf5]));
  else if (value === null) parts.push(new Uint8Array([0xf6]));
  else if (value === undefined) parts.push(new Uint8Array([0xf7]));
  else if (typeof value === "object") {
    const entries = Object.entries(value as { [key: string]: CborValue });
    parts.push(head(5, entries.length));
    for (const [key, item] of entries) { write(key, parts, depth + 1); write(item, parts, depth + 1); }
  } else throw new Error("cbor: unsupported value");
}

export function cborDecode(bytes: Uint8Array): CborValue {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const state = { offset: 0 };
  const value = readItem(bytes, view, state, 0);
  if (state.offset !== bytes.length) throw new Error("cbor: trailing bytes");
  return value;
}

function readItem(bytes: Uint8Array, view: DataView, state: { offset: number }, depth: number): CborValue {
  if (depth > MAX_DEPTH) throw new Error("cbor: depth limit exceeded");
  if (state.offset >= bytes.length) throw new Error("cbor: truncated input");
  const initial = bytes[state.offset++];
  const major = initial >> 5;
  const info = initial & 0x1f;
  if (major === 7) {
    if (info === 20) return false;
    if (info === 21) return true;
    if (info === 22) return null;
    if (info === 23) return undefined;
    throw new Error("cbor: unsupported simple value");
  }
  let length: number;
  if (info < 24) length = info;
  else if (info === 24) length = take(bytes, state, 1)[0];
  else if (info === 25) length = new DataView(take(bytes, state, 2).buffer).getUint16(0);
  else if (info === 26) length = new DataView(take(bytes, state, 4).buffer).getUint32(0);
  else if (info === 27) {
    const big = view.getBigUint64(state.offset);
    take(bytes, state, 8);
    if (big > BigInt(MAX_SAFE)) throw new Error("cbor: integer out of range");
    length = Number(big);
  } else throw new Error("cbor: unsupported additional information");
  if (major === 0) return length;
  if (major === 1) return -1 - length;
  if (length > bytes.length - state.offset) throw new Error("cbor: length exceeds input");
  if (major === 2) return take(bytes, state, length);
  if (major === 3) return new TextDecoder().decode(take(bytes, state, length));
  if (major === 4) {
    const items: CborValue[] = [];
    for (let index = 0; index < length; index++) items.push(readItem(bytes, view, state, depth + 1));
    return items;
  }
  if (major === 5) {
    const map = new Map<CborValue, CborValue>();
    for (let index = 0; index < length; index++) map.set(readItem(bytes, view, state, depth + 1), readItem(bytes, view, state, depth + 1));
    return map;
  }
  return new CborTag(length, readItem(bytes, view, state, depth + 1));
}

function take(bytes: Uint8Array, state: { offset: number }, count: number): Uint8Array {
  if (count > bytes.length - state.offset) throw new Error("cbor: truncated input");
  const slice = bytes.slice(state.offset, state.offset + count);
  state.offset += count;
  return slice;
}
