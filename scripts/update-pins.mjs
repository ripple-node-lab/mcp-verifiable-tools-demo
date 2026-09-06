import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const hashDocument = async (path) => {
  const bytes = await readFile(new URL(path, root));
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
};
const snarkjsHash = await hashDocument("packages/prover-snarkjs/circuits/add/vk.json");
const noirHash = await hashDocument("packages/prover-noir/circuits/add/vk.json");
const risc0Id = (await readFile(new URL("sidecars/risc0/image-id.txt", root), "utf8")).trim();
const metaUrl = new URL("packages/protocol/src/meta.ts", root);
const original = await readFile(metaUrl, "utf8");
const updated = original
  .replace(/("snarkjs-v2":\s*)"0x[0-9a-f]+"/, `$1"${snarkjsHash}"`)
  .replace(/("noir-v1":\s*)"0x[0-9a-f]+"/, `$1"${noirHash}"`)
  .replace(/("risc0-v1":\s*)"0x[0-9a-f]+"/, `$1"${risc0Id}"`);
if (updated !== original) await writeFile(metaUrl, updated);
console.log(`snarkjs-v2 ${snarkjsHash}`);
console.log(`noir-v1 ${noirHash}`);
console.log(`risc0-v1 ${risc0Id}`);
console.log(updated === original ? "pins unchanged" : "pins updated");
