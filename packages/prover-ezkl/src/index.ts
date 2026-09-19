// ezkl-v1: proof = an ezkl/Halo2-KZG proof JSON produced by the Python sidecar
// (ezkl 22.0.1 — must match @ezkljs/engine 22.0.1 exactly), verified in-process
// by the engine's wasm build. The circuit is a single ONNX Add plus 48 public
// binding inputs: input/param scale 0 maps integers exactly into field
// elements, so instances[0] =
//   [feltLE(a), feltLE(b), ob0..ob15, ib0..ib15, nb0..nb15, feltLE(sum)]
// where each bound value contributes its commitmentToField element as 16
// big-endian u16 limbs (limbs stay < 2^24 so they survive the f32 ONNX ingest
// exactly). meta.publicInputs stays [outputCommitment, inputCommitment, nonce,
// sum, a, b]; the proof itself covers all of them, so captured proofs cannot
// be replayed under a rewritten meta. circuitHash = sha256(vk.json bytes).
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { EMPTY_NONCE, VerifiableToolsMeta, commitmentToField, parseEzklAddArguments } from "@demo/protocol";
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

function decodeFeltLE(hex: string): bigint | undefined {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-f]{64}$/i.test(clean)) return undefined;
  const bytes = Buffer.from(clean, "hex").reverse();
  return BigInt(`0x${bytes.toString("hex")}`);
}

function decodeU32Felt(hex: string): bigint | undefined {
  const value = decodeFeltLE(hex);
  return value !== undefined && value <= FIELD_MASK ? value : undefined;
}

// Reassemble 16 big-endian u16 limbs (instances[i..i+15]) into the field
// element they encode; undefined when any entry isn't a u16.
function limbsToField(instances: string[], offset: number): bigint | undefined {
  let fe = 0n;
  for (let i = 0; i < 16; i++) {
    const limb = decodeFeltLE(instances[offset + i]);
    if (limb === undefined || limb > 0xffffn) return undefined;
    fe = (fe << 16n) | limb;
  }
  return fe;
}

const EXPECTED_INSTANCES = 51;

export async function verifyEzkl(meta: VerifiableToolsMeta, context: VerifyContext, signal?: AbortSignal): Promise<boolean> {
  if (meta.proofFormat !== FORMAT || meta.circuitHash !== context.expectedCircuitHash || !meta.proof) return false;
  let decoded: { proofBytes: ReturnType<typeof Buffer.from>; proof: EzklProof };
  try {
    const proofBytes = Buffer.from(meta.proof, "base64url");
    decoded = { proofBytes, proof: JSON.parse(proofBytes.toString("utf8")) as EzklProof };
  } catch { return false; }
  const { proofBytes, proof } = decoded;
  const instances = proof.instances?.[0];
  if (!Array.isArray(instances) || instances.length !== EXPECTED_INSTANCES) return false;
  const a = decodeU32Felt(instances[0]);
  const b = decodeU32Felt(instances[1]);
  const sum = decodeU32Felt(instances[EXPECTED_INSTANCES - 1]);
  if (a === undefined || b === undefined || sum === undefined) return false;
  const bound = [meta.outputCommitment, meta.inputCommitment, meta.nonce ?? EMPTY_NONCE];
  if (bound.some((v) => typeof v !== "string")) return false;
  for (const [i, hex] of bound.entries()) {
    let expected: bigint;
    try { expected = commitmentToField(hex as string); } catch { return false; }
    if (limbsToField(instances, 2 + i * 16) !== expected) return false;
  }
  const args = parseEzklAddArguments(context.arguments);
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
