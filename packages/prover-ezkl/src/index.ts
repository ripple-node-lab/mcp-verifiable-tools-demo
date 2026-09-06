// ezkl-v1: proof = an ezkl/Halo2-KZG proof JSON produced by the Python sidecar
// (ezkl 22.0.1 — must match @ezkljs/engine 22.0.1 exactly), verified in-process
// by the engine's wasm build. The circuit is a single ONNX Add over u32 inputs;
// input/param scale 0 maps integers exactly into field elements, so
// instances[0] = [feltLE(a), feltLE(b), feltLE(sum)]. Binding follows the
// snarkjs-v2 / noir-v1 / risc0-v1 pattern: commitments + nonce are checked by
// verifyResult and echoed in publicInputs[0..3]; circuit public inputs are
// [sum, a, b]. circuitHash = sha256(vk.json bytes).
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { EMPTY_NONCE, VerifiableToolsMeta, parseAddArguments } from "@demo/protocol";
import { Verifier, VerifyContext } from "@demo/verifier";
import { SidecarVerifier } from "@demo/prover-sidecar";
import { artifacts } from "./artifacts.js";

export { artifacts };

export const FORMAT = "ezkl-v1";

const FIELD_MASK = 0xffffffffn;

// @ezkljs/engine 22.0.1 ships a CommonJS entry (nodejs/ezkl.js) that loads its
// wasm synchronously; pull it in via createRequire and cache the loaded
// artifacts (served bytes, identical to the sidecar's).
type EzklEngine = { verify(proof: Uint8ClampedArray, vk: Uint8ClampedArray, settings: Uint8ClampedArray, srs: Uint8ClampedArray): boolean };
let cached: Promise<{ engine: EzklEngine; vk: Uint8ClampedArray; settings: Uint8ClampedArray; srs: Uint8ClampedArray }> | undefined;
function loadEngine() {
  cached ??= (async () => {
    const require = createRequire(import.meta.url);
    const engine = require("@ezkljs/engine") as unknown as EzklEngine;
    const load = (url: URL) => readFile(fileURLToPath(url)).then((b) => new Uint8ClampedArray(b));
    const [vk, settings, srs] = await Promise.all([load(artifacts.vk), load(artifacts.settings), load(artifacts.srs)]);
    return { engine, vk, settings, srs };
  })();
  return cached;
}

interface EzklProof {
  instances?: string[][];
}

function decodeU32Felt(hex: string): bigint | undefined {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-f]{64}$/i.test(clean)) return undefined;
  const bytes = Buffer.from(clean, "hex").reverse();
  const value = BigInt(`0x${bytes.toString("hex")}`);
  return value <= FIELD_MASK ? value : undefined;
}

export async function verifyEzkl(meta: VerifiableToolsMeta, context: VerifyContext, signal?: AbortSignal): Promise<boolean> {
  if (meta.proofFormat !== FORMAT || meta.circuitHash !== context.expectedCircuitHash || !meta.proof) return false;
  let decoded: { proofBytes: ReturnType<typeof Buffer.from>; proof: EzklProof };
  try {
    const proofBytes = Buffer.from(meta.proof, "base64url");
    decoded = { proofBytes, proof: JSON.parse(proofBytes.toString("utf8")) as EzklProof };
  } catch { return false; }
  const { proofBytes, proof } = decoded;
  const instances = proof.instances?.[0];
  if (!Array.isArray(instances) || instances.length !== 3) return false;
  const felts = instances.map(decodeU32Felt);
  if (felts.some((v) => v === undefined)) return false;
  const [a, b, sum] = felts as [bigint, bigint, bigint];
  const args = parseAddArguments(context.arguments);
  if (!args || BigInt(args.a) !== a || BigInt(args.b) !== b || sum !== a + b) return false;
  if (context.content[0]?.text !== String(sum)) return false;
  const expected = [meta.outputCommitment, meta.inputCommitment, meta.nonce ?? EMPTY_NONCE, String(sum), String(a), String(b)];
  const inputs = meta.publicInputs;
  if (!Array.isArray(inputs) || inputs.length !== expected.length ||
      !inputs.every((value, i) => typeof value === "string" && value === expected[i])) return false;
  const { engine, vk, settings, srs } = await loadEngine();
  let ok: boolean;
  try { ok = engine.verify(new Uint8ClampedArray(proofBytes), vk, settings, srs); } catch { return false; }
  signal?.throwIfAborted();
  return ok;
}

export class EzklVerifier implements Verifier {
  readonly format = FORMAT;
  async verify(meta: VerifiableToolsMeta, context: VerifyContext, options: { signal?: AbortSignal } = {}): Promise<boolean> {
    options.signal?.throwIfAborted();
    try { return await verifyEzkl(meta, context, options.signal); } catch (error) {
      if (options.signal?.aborted) throw error;
      return false;
    }
  }
}

export const verifier = new EzklVerifier();
export const sidecarVerifier = (baseUrl: string): Verifier => new SidecarVerifier({ baseUrl, format: FORMAT });
