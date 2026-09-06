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

export function isValidNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE_PATTERN.test(value);
}

export function freshNonce(bytes = 16): string {
  if (bytes < 16 || bytes > 64) throw new RangeError("nonce must be 16-64 bytes");
  return `0x${randomBytes(bytes).toString("hex")}`;
}
