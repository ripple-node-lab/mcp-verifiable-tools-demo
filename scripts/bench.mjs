import { readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import { startServer } from "@demo/server";
import { VerifiableClient } from "@demo/client";
import { EXTENSION_ID } from "@demo/protocol";
import { closeProverWorker as closeNoirWorker } from "@demo/prover-noir";
import { destroy as destroyNoir } from "@demo/prover-noir";
import { closeProverWorker as closeSnarkjsWorker } from "@demo/prover-snarkjs";

const root = new URL("../", import.meta.url);
const formats = ["snarkjs-v2", "noir-v1", "demo-sig-v1", "demo-commit-v1"];
const values = { a: 20, b: 22 };
const median = (items) => [...items].sort((a, b) => a - b)[Math.floor(items.length / 2)];
const p90 = (items) => [...items].sort((a, b) => a - b)[Math.ceil(items.length * 0.9) - 1];
const proofBytes = (proof, format) => Buffer.byteLength(proof.startsWith("0x") ? proof.slice(2) : proof, format === "snarkjs-v2" ? "base64url" : "hex");
const packageJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const size = async (path) => (await stat(new URL(path, root))).size;

const server = await startServer({ port: 0 });
try {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  client.setCapabilities({ proofFormats: discovery.proofFormats });
  const rows = [];
  for (const format of formats) {
    const proveMs = [];
    const verifyMs = [];
    let proofSize = 0;
    let vkSize = 0;
    let rssStart = process.memoryUsage().rss;
    let rssPeak = rssStart;
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();
      const call = await client.callTool("add", values, { proofFormat: format });
      proveMs.push(performance.now() - start);
      if (call.result.resultType !== "complete") throw new Error(`unexpected task for ${format}`);
      const meta = call.result._meta?.[EXTENSION_ID];
      proofSize = proofBytes(meta.proof, format);
      const descriptor = client.descriptor("add");
      const verificationKeyUri = meta.verificationKeyUri
        ?? descriptor?.formats?.[format]?.verificationKeyUri
        ?? descriptor?.verificationKeyUri;
      const vk = await fetch(verificationKeyUri);
      vkSize = (await vk.arrayBuffer()).byteLength;
      const verifyStart = performance.now();
      const outcome = await client.verify(call.result, values, "add", { nonce: call.nonce });
      verifyMs.push(performance.now() - verifyStart);
      if (!outcome.ok) throw new Error(`${format} verification failed: ${outcome.reason}`);
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    }
    const artifactSize = format === "snarkjs-v2"
      ? await size("packages/prover-snarkjs/circuits/add/add.wasm") + await size("packages/prover-snarkjs/circuits/add/add_final.zkey")
      : format === "noir-v1" ? await size("packages/prover-noir/circuits/add/target/add.json") : 0;
    rows.push({ format, medianProve: median(proveMs), p90Prove: p90(proveMs), medianVerify: median(verifyMs), proofSize, vkSize, artifactSize, rssDelta: rssPeak - rssStart });
  }
  const noir = await packageJson("packages/prover-noir/package.json");
  const snark = await packageJson("packages/prover-snarkjs/package.json");
  const text = [
    "# Phase 2-b benchmarks",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Machine: ${os.hostname()} (${os.platform()} ${os.release()}, ${os.arch()}, ${os.cpus().length} CPUs)`,
    `Node: ${process.version}`,
    `Packages: snarkjs ${snark.dependencies.snarkjs}; noir_js ${noir.dependencies["@noir-lang/noir_js"]}; bb.js ${noir.dependencies["@aztec/bb.js"]}`,
    "",
    "Ten sequential `{a:20,b:22}` calls per format. Prove time includes the in-process server call; verify time is client-side verification.",
    "",
    "| Format | Median prove ms | P90 prove ms | Median verify ms | Proof bytes | VK document bytes | Prover artifact bytes | RSS delta bytes |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.format} | ${row.medianProve.toFixed(2)} | ${row.p90Prove.toFixed(2)} | ${row.medianVerify.toFixed(2)} | ${row.proofSize} | ${row.vkSize} | ${row.artifactSize} | ${row.rssDelta} |`),
    "",
    "## Reproduction",
    "",
    "```sh",
    "npm ci",
    "npm run build",
    "npm run bench",
    "```",
    "",
    "The Circom trusted setup is a local, single-party, insecure demo ceremony; it is not production-secure. bb.js prints one proof-generation status line to stdout per proof in this version."
  ].join("\n");
  await writeFile(new URL("../docs/BENCHMARKS.md", import.meta.url), `${text}\n`);
  console.log(text);
} finally {
  await server.close();
  closeSnarkjsWorker();
  closeNoirWorker();
  await destroyNoir();
}
