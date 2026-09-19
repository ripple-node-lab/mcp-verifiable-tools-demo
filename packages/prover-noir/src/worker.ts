import { readFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { ProveInput } from "@demo/prover";
import { VerifiableToolsMeta, commitmentToField, parseAddArguments, publicInputs } from "@demo/protocol";
import { FORMAT, circuitHash, getApi } from "./runtime.js";
import { artifacts } from "./artifacts.js";

async function prove(input: ProveInput): Promise<VerifiableToolsMeta> {
  const circuit = JSON.parse(await readFile(artifacts.circuit, "utf8")) as { bytecode: string };
  const args = parseAddArguments(input.arguments);
  if (!args) throw new Error("arguments out of circuit range");
  // Commitments and nonce are public inputs to the circuit — the proof binds
  // them, so a replayed proof fails unless all three match.
  const witness = await new Noir(circuit as never).execute({
    a: args.a,
    b: args.b,
    out_commit: commitmentToField(input.outputCommitment).toString(),
    in_commit: commitmentToField(input.inputCommitment).toString(),
    nonce: commitmentToField(input.nonce ?? "0x").toString(),
  });
  const backend = new UltraHonkBackend(circuit.bytecode, await getApi());
  // bb.js logs "Generated proof for circuit ..." on every prove; keep it out of
  // the demo output (worker-local console, restored in finally).
  const originalLog = console.log;
  console.log = () => {};
  let result: Awaited<ReturnType<UltraHonkBackend["generateProof"]>>;
  try {
    result = await backend.generateProof(witness.witness);
  } finally {
    console.log = originalLog;
  }
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
