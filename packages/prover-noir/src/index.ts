import { readFile } from "node:fs/promises";
import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { JsonValue, VerifiableToolsMeta, publicInputs } from "@demo/protocol";
import { Prover, ProveInput } from "@demo/prover";
import { FORMAT, circuitHash, getApi, destroy } from "./runtime.js";

export { FORMAT, circuitHash, getApi, destroy } from "./runtime.js";
export const artifacts = { circuit: new URL("../../circuits/add/target/add.json", import.meta.url), vk: new URL("../../circuits/add/vk.json", import.meta.url) };
function args(value: JsonValue): { a: number; b: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof value.a !== "number" || !Number.isInteger(value.a) || value.a < 0 || value.a > 0xffffffff ||
      typeof value.b !== "number" || !Number.isInteger(value.b) || value.b < 0 || value.b > 0xffffffff) throw new Error("arguments out of circuit range");
  return { a: value.a, b: value.b };
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}
export class NoirProver implements Prover {
  readonly format = FORMAT;
  async prove(input: ProveInput, options: { signal?: AbortSignal } = {}): Promise<VerifiableToolsMeta> {
    checkAbort(options.signal);
    const circuit = JSON.parse(await readFile(artifacts.circuit, "utf8")) as { bytecode: string };
    const witness = await new Noir(circuit as never).execute(args(input.arguments));
    const backend = new UltraHonkBackend(circuit.bytecode, await getApi());
    const result = await backend.generateProof(witness.witness);
    checkAbort(options.signal);
    return {
      proof: `0x${Buffer.from(result.proof).toString("hex")}`,
      proofFormat: FORMAT,
      circuitHash,
      inputCommitment: input.inputCommitment,
      outputCommitment: input.outputCommitment,
      ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
      verificationKeyUri: input.verificationKeyUri,
      publicInputs: publicInputs(input.outputCommitment, input.inputCommitment, input.nonce, result.publicInputs)
    };
  }
}
export const prover: Prover = new NoirProver();
export { NoirVerifier, verifier, verifyNoir } from "./verifier.js";
