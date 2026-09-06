import test from "node:test";
import assert from "node:assert/strict";
import { CborTag, CborValue, cborDecode, cborEncode } from "@demo/protocol";

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

test("cbor encodes maps deterministically (RFC 8949 §4.2.1)", () => {
  const forward = new Map<CborValue, CborValue>([[1, 1], ["a", 1], [1000, 1], ["zz", 1]]);
  const reverse = new Map<CborValue, CborValue>([["zz", 1], [1000, 1], ["a", 1], [1, 1]]);
  const expected = "a401016161011903e801627a7a01";
  assert.equal(toHex(cborEncode(forward)), expected);
  assert.equal(toHex(cborEncode(reverse)), expected);
  assert.deepEqual(cborDecode(hex(expected)), forward);
});

test("cbor sorts nested map keys deterministically", () => {
  const one = cborEncode({ b: new Map<CborValue, CborValue>([["d", 1], ["c", 1]]), a: 0 });
  const two = cborEncode({ a: 0, b: new Map<CborValue, CborValue>([["c", 1], ["d", 1]]) });
  const expected = "a26161006162a2616301616401";
  assert.equal(toHex(one), expected);
  assert.equal(toHex(two), expected);
});

test("cbor rejects duplicate encoded map keys", () => {
  const dup = new Map<CborValue, CborValue>([[new Uint8Array([1]), 1], [new Uint8Array([1]), 2]]);
  assert.throws(() => cborEncode(dup));
});

test("cbor treats major-6 argument as a tag number, not a length", () => {
  const small = cborDecode(hex("d81800"));
  assert.deepEqual(small, new CborTag(24, 0));
  assert.equal(toHex(cborEncode(small)), "d81800");
  const large = new CborTag(1000, "x");
  assert.equal(toHex(cborEncode(large)), "d903e86178");
  assert.deepEqual(cborDecode(cborEncode(large)), large);
});

test("cbor applies the depth limit to map keys", () => {
  let deep: CborValue = [];
  for (let index = 0; index < 40; index++) deep = [deep];
  assert.throws(() => cborEncode(new Map<CborValue, CborValue>([[deep, 1]])), /depth limit/);
});

test("cbor rejects invalid utf-8 in text strings", () => {
  assert.throws(() => cborDecode(hex("62fffe")), /invalid utf-8/);
});

test("cbor rejects integers beyond 2^53", () => {
  assert.throws(() => cborDecode(hex("1bffffffffffffffff")));
  assert.throws(() => cborEncode(Number.MAX_SAFE_INTEGER + 1));
});
