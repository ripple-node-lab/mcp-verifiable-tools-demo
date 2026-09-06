// Minimal COSE_Sign1 (RFC 9052): tagged(18) [protected, unprotected, payload, signature].
import { CborTag, CborValue, cborDecode, cborEncode } from "./cbor.js";

export interface CoseSign1 {
  protectedHeader: Map<CborValue, CborValue>;
  unprotectedHeader: Map<CborValue, CborValue>;
  payload: Uint8Array;
  signature: Uint8Array;
  toBeSigned: Uint8Array;
}

export function coseSign1Encode(options: { protectedHeader: Map<CborValue, CborValue>; payload: Uint8Array; sign: (toBeSigned: Uint8Array) => Uint8Array }): Uint8Array {
  const protectedBstr = cborEncode(options.protectedHeader);
  const toBeSigned = cborEncode(["Signature1", protectedBstr, new Uint8Array(), options.payload]);
  return cborEncode(new CborTag(18, [protectedBstr, new Map(), options.payload, options.sign(toBeSigned)]));
}

export function coseSign1Decode(bytes: Uint8Array): CoseSign1 {
  let value = cborDecode(bytes);
  if (value instanceof CborTag) {
    if (value.tag !== 18) throw new Error("cose: unexpected tag");
    value = value.value;
  }
  if (!Array.isArray(value) || value.length !== 4) throw new Error("cose: malformed sign1");
  const [protectedBstr, unprotected, payload, signature] = value;
  if (!(protectedBstr instanceof Uint8Array) || !(unprotected instanceof Map) || !(payload instanceof Uint8Array) || !(signature instanceof Uint8Array)) throw new Error("cose: malformed sign1");
  const protectedHeader = cborDecode(protectedBstr);
  if (!(protectedHeader instanceof Map)) throw new Error("cose: malformed protected header");
  const toBeSigned = cborEncode(["Signature1", protectedBstr, new Uint8Array(), payload]);
  return { protectedHeader, unprotectedHeader: unprotected, payload, signature, toBeSigned };
}
