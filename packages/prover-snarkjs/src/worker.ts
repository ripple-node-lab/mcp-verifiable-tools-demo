import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import { ProveInput } from "@demo/prover";
import { VerifiableToolsMeta, jcs, parseAddArguments, publicInputs } from "@demo/protocol";
import { FORMAT, circuitHash } from "./constants.js";
import { artifacts } from "./artifacts.js";

// ffjavascript's web-worker adapter must treat this wrapper as its host thread.
createRequire(import.meta.url)("node:worker_threads").isMainThread = true;
const groth16Promise = import("snarkjs").then((module) => module.groth16);

async function prove(input: ProveInput): Promise<VerifiableToolsMeta> {
  const args = parseAddArguments(input.arguments);
  if (!args) throw new Error("arguments out of circuit range");
  const groth16 = await groth16Promise;
  const result = await groth16.fullProve(args, fileURLToPath(artifacts.wasm), fileURLToPath(artifacts.zkey), undefined, undefined, { singleThread: true });
  return {
    proof: Buffer.from(jcs(result.proof)).toString("base64url"),
    proofFormat: FORMAT,
    circuitHash,
    inputCommitment: input.inputCommitment,
    outputCommitment: input.outputCommitment,
    ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
    verificationKeyUri: input.verificationKeyUri,
    publicInputs: publicInputs(input.outputCommitment, input.inputCommitment, input.nonce, result.publicSignals)
  };
}

parentPort?.on("message", async (message: { id: number; input: ProveInput }) => {
  try {
    parentPort?.postMessage({ id: message.id, ok: true, meta: await prove(message.input) });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, ok: false, error: error instanceof Error ? { message: error.message, name: error.name } : { message: "prover worker failed", name: "Error" } });
  }
});
