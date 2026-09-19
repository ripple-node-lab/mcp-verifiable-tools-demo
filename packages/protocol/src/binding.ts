import { randomBytes } from "node:crypto";
import { CallToolResult, JsonValue } from "./types.js";
import { EMPTY_NONCE, NONCE_PATTERN } from "./constants.js";
import { jcs, sha256Hex } from "./jcs.js";

export function inputCommitment(args: JsonValue, salt?: Uint8Array): string {
  return sha256Hex(salt ?? new Uint8Array(), jcs(args));
}

export function outputCommitment(content: CallToolResult["content"]): string {
  return sha256Hex(jcs(content as unknown as JsonValue));
}

export function publicInputs(output: string, input: string, nonce: string | undefined, tail: JsonValue[] = []): JsonValue[] {
  return [output, input, nonce ?? EMPTY_NONCE, ...tail];
}

// BN254 (alt_bn128) scalar field order — the field snarkjs-v2 circuits use.
export const BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Encode a "0x"-hex commitment/nonce as a BN254 field element so it can be a
// circuit public input. "0x" (empty nonce) encodes to 0.
export function commitmentToField(hex: string): bigint {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return (clean === "" ? 0n : BigInt(`0x${clean}`)) % BN254_SCALAR_FIELD;
}

// Encode a commitment/nonce as 16 big-endian u16 limbs of its BN254 field
// element — for circuits (ezkl-v1) whose inputs must stay exactly
// representable (< 2^24) and so cannot take a 254-bit element directly.
export function commitmentToU16Limbs(hex: string): bigint[] {
  const fe = commitmentToField(hex);
  const limbs = new Array<bigint>(16);
  for (let i = 0; i < 16; i++) limbs[15 - i] = (fe >> BigInt(16 * i)) & 0xffffn;
  return limbs;
}

export function isValidNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE_PATTERN.test(value);
}

export function freshNonce(bytes = 16): string {
  if (bytes < 16 || bytes > 64) throw new RangeError("nonce must be 16-64 bytes");
  return `0x${randomBytes(bytes).toString("hex")}`;
}
