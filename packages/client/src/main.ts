import { startServer } from "@demo/server";
import { closeProverWorker as closeNoirWorker, destroy as destroyNoir } from "@demo/prover-noir";
import { closeProverWorker as closeSnarkjsWorker } from "@demo/prover-snarkjs";
import { VerifiableClient } from "./client.js";
import { TlsnProvenanceVerifier } from "@demo/prover-sidecar";
import { CallToolResult, EXTENSION_ID, freshNonce } from "@demo/protocol";

// One indented detail line per scenario: the checks verifyResult performed, in
// its order. Reaching this line means every check passed.
function checksLine(result: CallToolResult, extra?: string): string {
  const meta = result._meta?.[EXTENSION_ID];
  const hash = typeof meta?.circuitHash === "string" && meta.circuitHash.startsWith("0x") ? meta.circuitHash.slice(0, 10) : String(meta?.circuitHash);
  const attestation = meta?.inputAttestations?.[0];
  const provenance = attestation ? ` · provenance=ok (${attestation.type})` : "";
  return `   checks: circuitHash=${hash}… (pinned client-side) · inputCommitment=ok · outputCommitment=ok · nonce=ok · proof=ok (${meta?.proofFormat})${provenance}${extra ?? ""}`;
}

const server = await startServer({
  port: 0,
  risc0SidecarUrl: process.env.RISC0_SIDECAR_URL,
  risc0TimeoutMs: process.env.RISC0_SIDECAR_TIMEOUT_MS ? Number(process.env.RISC0_SIDECAR_TIMEOUT_MS) : undefined,
  ezklSidecarUrl: process.env.EZKL_SIDECAR_URL,
  tlsnSidecarUrl: process.env.TLSN_SIDECAR_URL,
});
try {
  const tlsnOrigin = process.env.TLSN_SIDECAR_URL ? new URL(process.env.TLSN_SIDECAR_URL).origin : undefined;
  const client = new VerifiableClient(server.mcpUrl, { allowedKeyOrigins: tlsnOrigin ? [tlsnOrigin] : [] });
  if (process.env.TLSN_SIDECAR_URL) client.addProvenanceVerifier(new TlsnProvenanceVerifier({ baseUrl: process.env.TLSN_SIDECAR_URL }));
  let verifiedCount = 0;
  let skippedCount = 0;
  const discovery = await client.discover();
  const addCall = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "demo-sig-v1" });
  if (addCall.result.resultType !== "complete") throw new Error("unexpected add task");
  const addOutcome = await client.verify(addCall.result, { a: 20, b: 22 }, "add", { nonce: addCall.nonce });
  if (!addOutcome.ok) throw new Error(`demo-sig-v1 verification failed: ${addOutcome.reason}`);
  verifiedCount++;
  console.log(`1. sync add: ${addCall.result.content[0].text} (verified demo-sig-v1)`);
  console.log(checksLine(addCall.result));
  client.setCapabilities({ proofFormats: discovery.proofFormats }, true);
  const risk = await client.callAndVerify("riskScore", { symbol: "AAPL" }, "demo-commit-v1");
  verifiedCount++;
  const riskProvenance = risk._meta?.[EXTENSION_ID]?.inputAttestations?.[0]?.type ?? "none";
  console.log(`2. async riskScore: ${risk.content[0].text} (verified demo-commit-v1, provenance ${riskProvenance})`);
  console.log(checksLine(risk));
  client.setCapabilities({ proofFormats: discovery.proofFormats, blindExecution: true });
  const credit = await client.blindCall({ income: 100000, debt: 30000 }, { encryptReply: true });
  verifiedCount++;
  console.log(`3. blind privateCreditCheck: ${credit.content[0].text} (verified demo-sig-v1)`);
  console.log(checksLine(credit, " · args=HPKE-encrypted (salted inputCommitment)"));
  const deferred = await client.callTool("priceQuote", { symbol: "AAPL" });
  if (deferred.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const resultId = deferred.result._meta?.[EXTENSION_ID]?.resultId;
  if (!resultId) throw new Error("missing deferred resultId");
  const proved = await client.prove(resultId);
  if (proved.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const verified = await client.verify(proved.result, { symbol: "AAPL" }, "priceQuote", { nonce: proved.nonce });
  if (!verified.ok) throw new Error(`deferred verification failed: ${verified.reason}`);
  verifiedCount++;
  console.log(`4. deferred priceQuote: ${proved.result.content[0].text} (verified ${proved.result._meta?.[EXTENSION_ID]?.proofFormat})`);
  console.log(checksLine(proved.result, " · via verifiable-tools/prove"));
  const tee = await client.callAndVerify("add", { a: 1, b: 2 }, "tee-nitro-v1");
  verifiedCount++;
  console.log(`5. tee add: ${tee.content[0].text} (verified tee-nitro-v1)`);
  console.log(checksLine(tee));
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
    verifiedCount++;
    const proof = call.result._meta?.[EXTENSION_ID]?.proof;
    const proofBytes = typeof proof === "string" ? Buffer.from(proof.startsWith("0x") ? proof.slice(2) : proof, format === "snarkjs-v2" ? "base64url" : "hex").byteLength : 0;
    console.log(`${number}. zk add (${label}): ${call.result.content[0].text} (verified, proof ${proofBytes} bytes, prove ${proveMs.toFixed(2)} ms, verify ${verifyMs.toFixed(2)} ms)`);
    console.log(checksLine(call.result));
  }
  for (const [number, format, label, envVar] of [[8, "risc0-v1", "risc0-v1 sidecar", "RISC0_SIDECAR_URL"], [9, "ezkl-v1", "ezkl-v1 sidecar", "EZKL_SIDECAR_URL"]] as const) {
    if (process.env[envVar]) {
      const proveStart = performance.now();
      const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: format });
      if (call.result.resultType !== "complete") throw new Error(`unexpected ${format} task`);
      const proveMs = performance.now() - proveStart;
      const verifyStart = performance.now();
      const outcome = await client.verify(call.result, { a: 20, b: 22 }, "add", { nonce: call.nonce });
      const verifyMs = performance.now() - verifyStart;
      if (!outcome.ok) throw new Error(`${format} verification failed: ${outcome.reason}`);
      verifiedCount++;
      const proof = call.result._meta?.[EXTENSION_ID]?.proof;
      const proofBytes = typeof proof === "string" ? Buffer.from(proof, "base64url").byteLength : 0;
      console.log(`${number}. zk add (${label}): ${call.result.content[0].text} (verified, proof ${proofBytes} bytes, prove ${proveMs.toFixed(2)} ms, verify ${verifyMs.toFixed(2)} ms)`);
      console.log(checksLine(call.result));
    } else {
      skippedCount++;
      console.log(`${number}. zk add (${label}): skipped (${envVar} unset)`);
    }
  }
  if (process.env.TLSN_SIDECAR_URL) {
    client.setCapabilities({ proofFormats: discovery.proofFormats, requireInputProvenance: true }, true);
    const call = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-commit-v1" });
    const result = call.result.resultType === "task" ? await client.poll(call.result) : call.result;
    if (result.resultType !== "complete") throw new Error("unexpected riskScore task");
    const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce: call.nonce });
    if (!outcome.ok) throw new Error(`tlsn provenance verification failed: ${outcome.reason}`);
    verifiedCount++;
    const attestation = result._meta?.[EXTENSION_ID]?.inputAttestations?.[0];
    const proofBytes = typeof attestation?.proof === "string" ? Buffer.from(attestation.proof, "base64url").byteLength : 0;
    console.log(`10. zktls riskScore: ${result.content[0].text} (verified demo-commit-v1, provenance ${attestation?.type}, presentation ${proofBytes} bytes)`);
    console.log(checksLine(result));
    client.setCapabilities({ proofFormats: discovery.proofFormats });
  } else {
    skippedCount++;
    console.log("10. zktls riskScore: skipped (TLSN_SIDECAR_URL unset)");
  }

  // Tamper detection: mutate the verified scenario-1 result client-side and
  // re-verify; each mutation must be rejected with the expected reason.
  console.log("Tamper checks (scenario 1 result mutated client-side, re-verified):");
  const tampered: [string, (result: CallToolResult) => void, string][] = [
    ["output 42 -> 43:     ", (result) => { result.content[0].text = "43"; }, "outputCommitmentMismatch"],
    ["nonce replaced:      ", () => { /* nonce swapped at verify call */ }, "nonceMismatch"],
    ["proof byte flipped:  ", (result) => {
      const meta = result._meta![EXTENSION_ID]!;
      const bytes = Buffer.from(String(meta.proof).replace(/^0x/, ""), "hex");
      bytes[bytes.length >> 1] ^= 0xff;
      meta.proof = `0x${bytes.toString("hex")}`;
    }, "proofInvalid"]
  ];
  let rejected = 0;
  for (const [label, mutate, reason] of tampered) {
    const copy = structuredClone(addCall.result);
    mutate(copy);
    const outcome = await client.verify(copy, { a: 20, b: 22 }, "add", { nonce: label.startsWith("nonce") ? freshNonce() : addCall.nonce });
    if (outcome.ok || outcome.reason !== reason) throw new Error(`tamper check failed: expected ${reason}, got ${outcome.ok ? "ok" : outcome.reason}`);
    rejected++;
    console.log(`   ${label} rejected (${outcome.reason})`);
  }
  console.log(`Summary: ${verifiedCount} verified, ${skippedCount} skipped, ${rejected}/3 tampered results rejected`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "demo failed");
  process.exitCode = 1;
} finally {
  await server.close();
  closeSnarkjsWorker();
  closeNoirWorker();
  await destroyNoir();
}
