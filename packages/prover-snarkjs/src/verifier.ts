import { createHash } from "node:crypto";
import { JsonValue, VerifiableToolsMeta } from "@demo/protocol";
import { Verifier, VerifyContext, VerificationKeyRegistry, VerificationKeyRegistryLike } from "@demo/verifier";
import { FORMAT, circuitHash } from "./constants.js";
import { groth16Promise } from "./runtime.js";

function parseArgs(value: JsonValue): { a: number; b: number } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof value.a !== "number" || !Number.isInteger(value.a) || value.a < 0 || value.a > 0xffffffff ||
      typeof value.b !== "number" || !Number.isInteger(value.b) || value.b < 0 || value.b > 0xffffffff) return undefined;
  return { a: value.a, b: value.b };
}

async function keyBytes(registry: VerificationKeyRegistryLike | undefined, hash: string, uri: string): Promise<Uint8Array> {
  if (registry && "getBytes" in registry && typeof registry.getBytes === "function") return await registry.getBytes(hash, uri);
  return await new VerificationKeyRegistry([new URL(uri).origin]).getBytes(hash, uri);
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}
export async function verifySnarkjs(meta: VerifiableToolsMeta, context: VerifyContext, signal?: AbortSignal): Promise<boolean> {
  checkAbort(signal);
  if (meta.proofFormat !== FORMAT || meta.circuitHash !== context.expectedCircuitHash || meta.circuitHash !== circuitHash || !meta.proof) return false;
  const args = parseArgs(context.arguments);
  const text = context.content[0]?.text;
  if (!args || text !== String(args.a + args.b) || !Array.isArray(meta.publicInputs) || meta.publicInputs.length !== 6) return false;
  const expectedTail = [String(args.a + args.b), String(args.a), String(args.b)];
  if (JSON.stringify(meta.publicInputs.slice(3)) !== JSON.stringify(expectedTail)) return false;
  const uri = context.verificationKeyUri ?? meta.verificationKeyUri;
  if (!uri) return false;
  const registry = context.registry;
  const bytes = await keyBytes(registry, meta.circuitHash, uri);
  if (`0x${createHash("sha256").update(bytes).digest("hex")}` !== meta.circuitHash) return false;
  const vk = JSON.parse(new TextDecoder().decode(bytes)) as JsonValue;
  const proof = JSON.parse(Buffer.from(meta.proof, "base64url").toString("utf8")) as JsonValue;
  const groth16 = await groth16Promise;
  const processState = process as unknown as { browser?: boolean };
  const previousBrowser = processState.browser;
  processState.browser = true;
  let valid: boolean;
  try {
    valid = await groth16.verify(vk, expectedTail, proof);
  } finally {
    processState.browser = previousBrowser;
  }
  checkAbort(signal);
  return valid;
}

export class SnarkjsVerifier implements Verifier {
  readonly format = FORMAT;
  async verify(meta: VerifiableToolsMeta, context: VerifyContext, options: { signal?: AbortSignal } = {}): Promise<boolean> {
    try { return await verifySnarkjs(meta, context, options.signal); } catch (error) {
      if (options.signal?.aborted) throw error;
      return false;
    }
  }
}

export const verifier: Verifier = new SnarkjsVerifier();
