import { createHash } from "node:crypto";
import { UltraHonkVerifierBackend } from "@aztec/bb.js";
import { JsonValue, VerifiableToolsMeta } from "@demo/protocol";
import { Verifier, VerifyContext, VerificationKeyRegistry } from "@demo/verifier";
import { FORMAT, circuitHash, getApi } from "./runtime.js";

function parseArgs(value: JsonValue): { a: number; b: number } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof value.a !== "number" || !Number.isInteger(value.a) || value.a < 0 || value.a > 0xffffffff ||
      typeof value.b !== "number" || !Number.isInteger(value.b) || value.b < 0 || value.b > 0xffffffff) return undefined;
  return { a: value.a, b: value.b };
}
async function keyBytes(context: VerifyContext, hash: string, uri: string): Promise<Uint8Array> {
  const registry = context.registry;
  if (registry && "getBytes" in registry && typeof registry.getBytes === "function") return await registry.getBytes(hash, uri);
  return await new VerificationKeyRegistry([new URL(uri).origin]).getBytes(hash, uri);
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}
export async function verifyNoir(meta: VerifiableToolsMeta, context: VerifyContext, signal?: AbortSignal): Promise<boolean> {
  checkAbort(signal);
  if (meta.proofFormat !== FORMAT || meta.circuitHash !== context.expectedCircuitHash || meta.circuitHash !== circuitHash || !meta.proof) return false;
  const args = parseArgs(context.arguments);
  if (!args || context.content[0]?.text !== String(args.a + args.b) || !Array.isArray(meta.publicInputs) || meta.publicInputs.length !== 6) return false;
  const expected = [args.a, args.b, args.a + args.b].map((value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`);
  const tail = meta.publicInputs.slice(3);
  if (tail.length !== expected.length || tail.some((value, index) => value !== expected[index])) return false;
  const uri = context.verificationKeyUri ?? meta.verificationKeyUri;
  if (!uri) return false;
  const bytes = await keyBytes(context, meta.circuitHash, uri);
  if (`0x${createHash("sha256").update(bytes).digest("hex")}` !== meta.circuitHash) return false;
  const document = JSON.parse(new TextDecoder().decode(bytes)) as { format?: string; vk?: string };
  if (document.format !== FORMAT || typeof document.vk !== "string") return false;
  const proof = Uint8Array.from(Buffer.from(meta.proof.slice(2), "hex"));
  const verificationKey = Uint8Array.from(Buffer.from(document.vk, "base64url"));
  const verifier = new UltraHonkVerifierBackend(await getApi());
  const valid = await verifier.verifyProof({ proof, publicInputs: tail as string[], verificationKey });
  checkAbort(signal);
  return valid;
}
export class NoirVerifier implements Verifier {
  readonly format = FORMAT;
  async verify(meta: VerifiableToolsMeta, context: VerifyContext, options: { signal?: AbortSignal } = {}): Promise<boolean> {
    try { return await verifyNoir(meta, context, options.signal); } catch (error) {
      if (options.signal?.aborted) throw error;
      return false;
    }
  }
}
export const verifier: Verifier = new NoirVerifier();
