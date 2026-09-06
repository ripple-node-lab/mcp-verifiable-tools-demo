import { readFile, writeFile } from "node:fs/promises";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";

const root = new URL("../", import.meta.url);
const circuit = JSON.parse(await readFile(new URL("packages/prover-noir/circuits/add/target/add.json", root), "utf8"));
const api = await Barretenberg.new({ threads: 1 });
try {
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  const verificationKey = await backend.getVerificationKey();
  const document = JSON.stringify({
    format: "noir-v1",
    vk: Buffer.from(verificationKey).toString("base64url")
  });
  await writeFile(new URL("packages/prover-noir/circuits/add/vk.json", root), document);
} finally {
  await api.destroy();
}
