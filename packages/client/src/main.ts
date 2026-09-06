import { startServer } from "@demo/server";
import { closeProverWorker as closeNoirWorker, destroy as destroyNoir } from "@demo/prover-noir";
import { closeProverWorker as closeSnarkjsWorker } from "@demo/prover-snarkjs";
import { VerifiableClient } from "./client.js";
import { EXTENSION_ID } from "@demo/protocol";
const server = await startServer({
  port: 0,
  risc0SidecarUrl: process.env.RISC0_SIDECAR_URL,
  risc0TimeoutMs: process.env.RISC0_SIDECAR_TIMEOUT_MS ? Number(process.env.RISC0_SIDECAR_TIMEOUT_MS) : undefined,
  ezklSidecarUrl: process.env.EZKL_SIDECAR_URL,
});
try {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const add = await client.callAndVerify("add", { a: 20, b: 22 }, "demo-sig-v1");
  console.log(`1. sync add: ${add.content[0].text} (verified demo-sig-v1)`);
  client.setCapabilities({ proofFormats: discovery.proofFormats }, true);
  const risk = await client.callAndVerify("riskScore", { symbol: "AAPL" }, "demo-commit-v1");
  console.log(`2. async riskScore: ${risk.content[0].text} (verified demo-commit-v1, provenance oracle-sig-v1)`);
  client.setCapabilities({ proofFormats: discovery.proofFormats, blindExecution: true });
  const credit = await client.blindCall({ income: 100000, debt: 30000 }, { encryptReply: true });
  console.log(`3. blind privateCreditCheck: ${credit.content[0].text} (verified demo-sig-v1)`);
  const deferred = await client.callTool("priceQuote", { symbol: "AAPL" });
  if (deferred.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const resultId = deferred.result._meta?.[EXTENSION_ID]?.resultId;
  if (!resultId) throw new Error("missing deferred resultId");
  const proved = await client.prove(resultId);
  if (proved.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const verified = await client.verify(proved.result, { symbol: "AAPL" }, "priceQuote", { nonce: proved.nonce });
  if (!verified.ok) throw new Error(`deferred verification failed: ${verified.reason}`);
  console.log(`4. deferred priceQuote: ${proved.result.content[0].text} (verified ${proved.result._meta?.[EXTENSION_ID]?.proofFormat})`);
  const tee = await client.callAndVerify("add", { a: 1, b: 2 }, "tee-nitro-v1");
  console.log(`5. tee add: ${tee.content[0].text} (verified tee-nitro-v1)`);
  client.setCapabilities({ proofFormats: discovery.proofFormats });
  for (const [number, format, label] of [[6, "snarkjs-v2", "snarkjs-v2 Groth16"], [7, "noir-v1", "noir-v1 UltraHonk"]] as const) {
    const proveStart = performance.now();
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: format });
    if (call.result.resultType !== "complete") throw new Error("unexpected ZK task");
    const proveMs = performance.now() - proveStart;
    const verifyStart = performance.now();
    const outcome = await client.verify(call.result, { a: 20, b: 22 }, "add", { nonce: call.nonce });
    const verifyMs = performance.now() - verifyStart;
    if (!outcome.ok) throw new Error(`${format} verification failed: ${outcome.reason}`);
    const proof = call.result._meta?.[EXTENSION_ID]?.proof;
    const proofBytes = typeof proof === "string" ? Buffer.from(proof.startsWith("0x") ? proof.slice(2) : proof, format === "snarkjs-v2" ? "base64url" : "hex").byteLength : 0;
    console.log(`${number}. zk add (${label}): ${call.result.content[0].text} (verified, proof ${proofBytes} bytes, prove ${proveMs.toFixed(2)} ms, verify ${verifyMs.toFixed(2)} ms)`);
  }
  if (process.env.RISC0_SIDECAR_URL) {
    const proveStart = performance.now();
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "risc0-v1" });
    if (call.result.resultType !== "complete") throw new Error("unexpected risc0 task");
    const proveMs = performance.now() - proveStart;
    const verifyStart = performance.now();
    const outcome = await client.verify(call.result, { a: 20, b: 22 }, "add", { nonce: call.nonce });
    const verifyMs = performance.now() - verifyStart;
    if (!outcome.ok) throw new Error(`risc0-v1 verification failed: ${outcome.reason}`);
    const proof = call.result._meta?.[EXTENSION_ID]?.proof;
    const proofBytes = typeof proof === "string" ? Buffer.from(proof, "base64url").byteLength : 0;
    console.log(`8. zk add (risc0-v1 sidecar): ${call.result.content[0].text} (verified, proof ${proofBytes} bytes, prove ${proveMs.toFixed(2)} ms, verify ${verifyMs.toFixed(2)} ms)`);
  } else {
    console.log("8. zk add (risc0-v1 sidecar): skipped (RISC0_SIDECAR_URL unset)");
  }
  if (process.env.EZKL_SIDECAR_URL) {
    const proveStart = performance.now();
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "ezkl-v1" });
    if (call.result.resultType !== "complete") throw new Error("unexpected ezkl task");
    const proveMs = performance.now() - proveStart;
    const verifyStart = performance.now();
    const outcome = await client.verify(call.result, { a: 20, b: 22 }, "add", { nonce: call.nonce });
    const verifyMs = performance.now() - verifyStart;
    if (!outcome.ok) throw new Error(`ezkl-v1 verification failed: ${outcome.reason}`);
    const proof = call.result._meta?.[EXTENSION_ID]?.proof;
    const proofBytes = typeof proof === "string" ? Buffer.from(proof, "base64url").byteLength : 0;
    console.log(`9. zk add (ezkl-v1 sidecar): ${call.result.content[0].text} (verified, proof ${proofBytes} bytes, prove ${proveMs.toFixed(2)} ms, verify ${verifyMs.toFixed(2)} ms)`);
  } else {
    console.log("9. zk add (ezkl-v1 sidecar): skipped (EZKL_SIDECAR_URL unset)");
  }
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "demo failed");
  process.exitCode = 1;
} finally {
  await server.close();
  closeSnarkjsWorker();
  closeNoirWorker();
  await destroyNoir();
}
