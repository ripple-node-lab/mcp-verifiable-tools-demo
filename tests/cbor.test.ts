import test from "node:test";
import assert from "node:assert/strict";
import { CborValue, cborDecode, cborEncode } from "@demo/protocol";

const hex = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "hex"));
const toHex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

// RFC 8949 Appendix A vectors.
const vectors: Array<[string, CborValue]> = [
  ["00", 0],
  ["1864", 100],
  ["20", -1],
  ["6161", "a"],
  ["4101", new Uint8Array([1])],
  ["83010203", [1, 2, 3]],
  ["a201020304", new Map<CborValue, CborValue>([[1, 2], [3, 4]])],
  ["f5", true],
  ["f6", null]
];

test("cbor decodes RFC 8949 appendix A vectors", () => {
  for (const [input, expected] of vectors) assert.deepEqual(cborDecode(hex(input)), expected);
});

test("cbor encode round-trips the vectors canonically", () => {
  for (const [input] of vectors) assert.equal(toHex(cborEncode(cborDecode(hex(input)))), input);
});

test("cbor rejects indefinite-length items", () => {
  assert.throws(() => cborDecode(hex("9f01ff")));
});

test("cbor rejects trailing bytes and truncation", () => {
  assert.throws(() => cborDecode(hex("0000")));
  assert.throws(() => cborDecode(hex("18")));
  assert.throws(() => cborDecode(hex("8301")));
});

test("cbor rejects integers beyond 2^53", () => {
  assert.throws(() => cborDecode(hex("1bffffffffffffffff")));
  assert.throws(() => cborEncode(Number.MAX_SAFE_INTEGER + 1));
});
