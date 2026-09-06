import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const hashDocument = async (path) => {
  const bytes = await readFile(new URL(path, root));
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
};
const snarkjsHash = await hashDocument("packages/prover-snarkjs/circuits/add/vk.json");
const noirHash = await hashDocument("packages/prover-noir/circuits/add/vk.json");
const metaUrl = new URL("packages/protocol/src/meta.ts", root);
const original = await readFile(metaUrl, "utf8");
const updated = original
  .replace(/("snarkjs-v2":\s*)"0x[0-9a-f]+"/, `$1"${snarkjsHash}"`)
  .replace(/("noir-v1":\s*)"0x[0-9a-f]+"/, `$1"${noirHash}"`);
if (updated !== original) await writeFile(metaUrl, updated);
console.log(`snarkjs-v2 ${snarkjsHash}`);
console.log(`noir-v1 ${noirHash}`);
console.log(updated === original ? "pins unchanged" : "pins updated");
