import { readFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { ProveInput } from "@demo/prover";
import { VerifiableToolsMeta, parseAddArguments, publicInputs } from "@demo/protocol";
import { FORMAT, circuitHash, getApi } from "./runtime.js";
import { artifacts } from "./artifacts.js";

async function prove(input: ProveInput): Promise<VerifiableToolsMeta> {
  const circuit = JSON.parse(await readFile(artifacts.circuit, "utf8")) as { bytecode: string };
  const args = parseAddArguments(input.arguments);
  if (!args) throw new Error("arguments out of circuit range");
  const witness = await new Noir(circuit as never).execute(args);
  const backend = new UltraHonkBackend(circuit.bytecode, await getApi());
  const result = await backend.generateProof(witness.witness);
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

parentPort?.on("message", async (message: { id: number; input: ProveInput }) => {
  try {
    parentPort?.postMessage({ id: message.id, ok: true, meta: await prove(message.input) });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, ok: false, error: error instanceof Error ? { message: error.message, name: error.name } : { message: "prover worker failed", name: "Error" } });
  }
});
