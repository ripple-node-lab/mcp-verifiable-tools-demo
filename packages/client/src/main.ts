import { startServer } from "@demo/server";
import { closeProverWorker as closeNoirWorker, destroy as destroyNoir } from "@demo/prover-noir";
import { closeProverWorker as closeSnarkjsWorker } from "@demo/prover-snarkjs";
import { VerifiableClient } from "./client.js";
import { TlsnProvenanceVerifier } from "@demo/prover-sidecar";
import { CallToolResult, EXTENSION_ID, freshNonce, JsonValue } from "@demo/protocol";

const verbose = process.env.DEMO_VERBOSE !== "0";
const narrate = (what: string): void => { if (verbose) console.log(`   what: ${what}`); };
const means = (text: string): void => { if (verbose) console.log(`   means: ${text}`); };

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
  const formatCounts = new Map<string, number>();
  let skippedCount = 0;
  const track = (result: CallToolResult): void => {
    const format = result._meta?.[EXTENSION_ID]?.proofFormat ?? "unknown";
    formatCounts.set(format, (formatCounts.get(format) ?? 0) + 1);
  };
  const sidecars = ["RISC0_SIDECAR_URL", "EZKL_SIDECAR_URL", "TLSN_SIDECAR_URL"].filter((name) => process.env[name]);
  if (verbose) {
    console.log(`MCP verifiable-tools demo — server runs in-process as an UNTRUSTED operator; the client
verifies each result against keys/roots pinned locally by circuitHash (never fetched from the server).
Evidence travels in CallToolResult._meta["${EXTENSION_ID}"]. Node ${process.version}; sidecars: ${sidecars.length ? sidecars.join(", ") : "none (scenarios 8-10 skipped)"}`);
    console.log();
  }
  const discovery = await client.discover();

  narrate("sync tools/call for add(20,22) with proofFormat demo-sig-v1; client supplies a fresh nonce");
  const addCall = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "demo-sig-v1" });
  if (addCall.result.resultType !== "complete") throw new Error("unexpected add task");
  const addOutcome = await client.verify(addCall.result, { a: 20, b: 22 }, "add", { nonce: addCall.nonce });
  if (!addOutcome.ok) throw new Error(`demo-sig-v1 verification failed: ${addOutcome.reason}`);
  track(addCall.result);
  console.log(`1. sync add: ${addCall.result.content[0].text} (verified demo-sig-v1)`);
  console.log(checksLine(addCall.result));
  means("server signed (result, commitments, nonce) with a key pinned by circuitHash. demo-sig-v1 is a DEMO format: it proves origin and freshness, NOT that 20+22 was computed correctly.");

  client.setCapabilities({ proofFormats: discovery.proofFormats }, true);
  narrate("riskScore(AAPL) runs as an MCP Task (tasks/get polling); result carries an oracle-sig-v1 attestation for the upstream price it used");
  const riskCall = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-commit-v1" });
  const risk = riskCall.result.resultType === "task" ? await client.poll(riskCall.result) : riskCall.result;
  if (risk.resultType !== "complete") throw new Error("unexpected riskScore task");
  const riskOutcome = await client.verify(risk, { symbol: "AAPL" }, "riskScore", { nonce: riskCall.nonce });
  if (!riskOutcome.ok) throw new Error(`riskScore verification failed: ${riskOutcome.reason}`);
  track(risk);
  const riskProvenance = risk._meta?.[EXTENSION_ID]?.inputAttestations?.[0]?.type ?? "none";
  console.log(`2. async riskScore: ${risk.content[0].text} (verified demo-commit-v1, provenance ${riskProvenance})`);
  console.log(checksLine(risk));
  means("the attestation commitment is bound into publicInputs, so the proof covers WHICH input the server used, and the oracle key is pinned by URI. demo-commit-v1 is a DEMO format.");

  client.setCapabilities({ proofFormats: discovery.proofFormats, blindExecution: true });
  narrate("privateCreditCheck(income, debt) via verifiable-tools/call: arguments HPKE-encrypted to the tool key, inputCommitment salted; reply encrypted back");
  let encryptedBytes = 0;
  const credit = await client.blindCall({ income: 100000, debt: 30000 }, {
    encryptReply: true,
    onEncrypted: (info) => { encryptedBytes = info.encryptedArgumentsBytes; }
  });
  track(credit);
  console.log(`3. blind privateCreditCheck: ${credit.content[0].text} (verified demo-sig-v1)`);
  console.log(checksLine(credit, " · args=HPKE-encrypted (salted inputCommitment)"));
  if (verbose) console.log(`   server saw: inputCommitment + ${encryptedBytes} bytes of HPKE ciphertext (no plaintext income/debt)`);
  means("the client verified the result against ITS salted commitment, so the result is for exactly the encrypted arguments. Confidentiality here relies on the enclave/prover holding the tool key (demo: same process).");

  narrate("priceQuote(AAPL) returns immediately with a resultId and no proof; client fetches the proof later with verifiable-tools/prove");
  const deferred = await client.callTool("priceQuote", { symbol: "AAPL" });
  if (deferred.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const resultId = deferred.result._meta?.[EXTENSION_ID]?.resultId;
  if (!resultId) throw new Error("missing deferred resultId");
  const proved = await client.prove(resultId);
  if (proved.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const verified = await client.verify(proved.result, { symbol: "AAPL" }, "priceQuote", { nonce: proved.nonce });
  if (!verified.ok) throw new Error(`deferred verification failed: ${verified.reason}`);
  track(proved.result);
  console.log(`4. deferred priceQuote: ${proved.result.content[0].text} (verified ${proved.result._meta?.[EXTENSION_ID]?.proofFormat})`);
  console.log(checksLine(proved.result, " · via verifiable-tools/prove"));
  means("proof generation is decoupled from the tool call; the deferred proof binds to the original result via resultId + commitments.");

  narrate("add(1,2) with tee-nitro-v1: result comes with an AWS Nitro-style attestation document (COSE_Sign1, PCRs, userData)");
  const teeCall = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "tee-nitro-v1" });
  if (teeCall.result.resultType !== "complete") throw new Error("unexpected tee task");
  const teeOutcome = await client.verify(teeCall.result, { a: 1, b: 2 }, "add", { nonce: teeCall.nonce });
  if (!teeOutcome.ok) throw new Error(`tee-nitro-v1 verification failed: ${teeOutcome.reason}`);
  const tee = teeCall.result;
  track(tee);
  console.log(`5. tee add: ${tee.content[0].text} (verified tee-nitro-v1)`);
  console.log(checksLine(tee));
  means("client checked the attestation cert chain to the pinned root, pinned PCRs, nonce, and userData = hash of the tool's HPKE key; the enclave key certified there signed the commitments. MOCK attestation: root/PCR fixtures are generated locally, not from real Nitro hardware.");

  client.setCapabilities({ proofFormats: discovery.proofFormats });
  for (const [number, format, label, what, meaning] of [
    [6, "snarkjs-v2", "snarkjs-v2 Groth16", "add(20,22) with snarkjs-v2: REAL Groth16 proof (circom circuit), verified in-process with a pinned verification key", "the proof itself shows 20+22=42 was computed by the pinned circuit. Caveat: single-party trusted setup (demo ceremony)."],
    [7, "noir-v1", "noir-v1 UltraHonk", "add(20,22) with noir-v1: REAL UltraHonk proof (Noir circuit, bb.js), no trusted setup", "same guarantee as 6 without a trusted setup; larger proof."]
  ] as const) {
    narrate(what);
    const proveStart = performance.now();
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: format });
    if (call.result.resultType !== "complete") throw new Error("unexpected ZK task");
    const proveMs = performance.now() - proveStart;
    const verifyStart = performance.now();
    const outcome = await client.verify(call.result, { a: 20, b: 22 }, "add", { nonce: call.nonce });
    const verifyMs = performance.now() - verifyStart;
    if (!outcome.ok) throw new Error(`${format} verification failed: ${outcome.reason}`);
    track(call.result);
    const proof = call.result._meta?.[EXTENSION_ID]?.proof;
    const proofBytes = typeof proof === "string" ? Buffer.from(proof.startsWith("0x") ? proof.slice(2) : proof, format === "snarkjs-v2" ? "base64url" : "hex").byteLength : 0;
    console.log(`${number}. zk add (${label}): ${call.result.content[0].text} (verified, proof ${proofBytes} bytes, prove ${proveMs.toFixed(2)} ms, verify ${verifyMs.toFixed(2)} ms)`);
    console.log(checksLine(call.result));
    means(meaning);
  }
  for (const [number, format, label, envVar, profile, port, what, meaning] of [
    [8, "risc0-v1", "risc0-v1 sidecar", "RISC0_SIDECAR_URL", "risc0", "4200", "add(20,22) proved in a Rust RISC Zero zkVM sidecar (receipt verified in-process via WASM)", "REAL zkVM receipt: any Rust program, no circuit authoring"],
    [9, "ezkl-v1", "ezkl-v1 sidecar", "EZKL_SIDECAR_URL", "ezkl", "4300", "add(20,22) proved by a Python ezkl ZKML sidecar (verified in-process via @ezkljs/engine)", "REAL ZKML proof over an ONNX model"]
  ] as const) {
    if (process.env[envVar]) {
      narrate(what);
      const proveStart = performance.now();
      const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: format });
      if (call.result.resultType !== "complete") throw new Error(`unexpected ${format} task`);
      const proveMs = performance.now() - proveStart;
      const verifyStart = performance.now();
      const outcome = await client.verify(call.result, { a: 20, b: 22 }, "add", { nonce: call.nonce });
      const verifyMs = performance.now() - verifyStart;
      if (!outcome.ok) throw new Error(`${format} verification failed: ${outcome.reason}`);
      track(call.result);
      const proof = call.result._meta?.[EXTENSION_ID]?.proof;
      const proofBytes = typeof proof === "string" ? Buffer.from(proof, "base64url").byteLength : 0;
      console.log(`${number}. zk add (${label}): ${call.result.content[0].text} (verified, proof ${proofBytes} bytes, prove ${proveMs.toFixed(2)} ms, verify ${verifyMs.toFixed(2)} ms)`);
      console.log(checksLine(call.result));
      means(meaning);
    } else {
      skippedCount++;
      console.log(`${number}. zk add (${label}): skipped (${envVar} unset)`);
      if (verbose) console.log(`   enable: docker compose --profile ${profile} up -d && export ${envVar}=http://localhost:${port}`);
    }
  }
  if (process.env.TLSN_SIDECAR_URL) {
    narrate("riskScore(AAPL) with a TLSNotary presentation of the upstream HTTPS response as provenance (requireInputProvenance=true)");
    client.setCapabilities({ proofFormats: discovery.proofFormats, requireInputProvenance: true }, true);
    const call = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-commit-v1" });
    const result = call.result.resultType === "task" ? await client.poll(call.result) : call.result;
    if (result.resultType !== "complete") throw new Error("unexpected riskScore task");
    const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce: call.nonce });
    if (!outcome.ok) throw new Error(`tlsn provenance verification failed: ${outcome.reason}`);
    track(result);
    const attestation = result._meta?.[EXTENSION_ID]?.inputAttestations?.[0];
    const proofBytes = typeof attestation?.proof === "string" ? Buffer.from(attestation.proof, "base64url").byteLength : 0;
    console.log(`10. zktls riskScore: ${result.content[0].text} (verified demo-commit-v1, provenance ${attestation?.type}, presentation ${proofBytes} bytes)`);
    console.log(checksLine(result));
    means("REAL zkTLS provenance: the upstream response is proven to come from that TLS server, and is bound into publicInputs");
    client.setCapabilities({ proofFormats: discovery.proofFormats });
  } else {
    skippedCount++;
    console.log("10. zktls riskScore: skipped (TLSN_SIDECAR_URL unset)");
    if (verbose) console.log("   enable: docker compose --profile tlsn up -d && export TLSN_SIDECAR_URL=http://localhost:4400");
  }

  // Tamper detection: mutate verified results client-side and re-verify; each
  // mutation must be rejected with the expected reason.
  console.log("Tamper checks (verified results mutated client-side, re-verified):");
  type Tamper = { label: string; result: CallToolResult; args: JsonValue; tool: string; nonce: string; mutate?: (result: CallToolResult) => void; reason: string; requireProvenance?: boolean };
  const tamperCases: Tamper[] = [
    { label: "output 42 -> 43 (#1):", result: addCall.result, args: { a: 20, b: 22 }, tool: "add", nonce: addCall.nonce, mutate: (r) => { r.content[0].text = "43"; }, reason: "outputCommitmentMismatch" },
    { label: "nonce replaced (#1):", result: addCall.result, args: { a: 20, b: 22 }, tool: "add", nonce: freshNonce(), reason: "nonceMismatch" },
    { label: "proof byte flipped (#1):", result: addCall.result, args: { a: 20, b: 22 }, tool: "add", nonce: addCall.nonce, mutate: (r) => {
      const meta = r._meta![EXTENSION_ID]!;
      const bytes = Buffer.from(String(meta.proof).replace(/^0x/, ""), "hex");
      bytes[bytes.length >> 1] ^= 0xff;
      meta.proof = `0x${bytes.toString("hex")}`;
    }, reason: "proofInvalid" },
    // Stripping the attestation rejects with proofInvalid, not
    // provenanceMissing: the attestation commit is bound into publicInputs, so
    // the proof itself no longer verifies once it is removed.
    { label: "provenance stripped (#2):", result: risk, args: { symbol: "AAPL" }, tool: "riskScore", nonce: riskCall.nonce, mutate: (r) => { delete r._meta![EXTENSION_ID]!.inputAttestations; }, reason: "proofInvalid", requireProvenance: true },
    { label: "attestation doc flipped (#5):", result: tee, args: { a: 1, b: 2 }, tool: "add", nonce: teeCall.nonce, mutate: (r) => {
      const meta = r._meta![EXTENSION_ID]!;
      const bytes = Buffer.from(String(meta.teeAttestation).replace(/^0x/, ""), "hex");
      bytes[bytes.length >> 1] ^= 0xff;
      meta.teeAttestation = `0x${bytes.toString("hex")}`;
    }, reason: "proofInvalid" }
  ];
  let rejected = 0;
  for (const tamper of tamperCases) {
    if (tamper.requireProvenance) client.setCapabilities({ proofFormats: discovery.proofFormats, requireInputProvenance: true }, true);
    const copy = structuredClone(tamper.result);
    tamper.mutate?.(copy);
    const outcome = await client.verify(copy, tamper.args, tamper.tool, { nonce: tamper.nonce });
    if (tamper.requireProvenance) client.setCapabilities({ proofFormats: discovery.proofFormats }, true);
    if (outcome.ok || outcome.reason !== tamper.reason) throw new Error(`tamper check failed: expected ${tamper.reason}, got ${outcome.ok ? "ok" : outcome.reason}`);
    rejected++;
    console.log(`   ${tamper.label.padEnd(30)} rejected (${outcome.reason})`);
  }
  const real = ["snarkjs-v2", "noir-v1", "risc0-v1", "ezkl-v1"].reduce((n, f) => n + (formatCounts.get(f) ?? 0), 0);
  const demo = ["demo-sig-v1", "demo-commit-v1"].reduce((n, f) => n + (formatCounts.get(f) ?? 0), 0);
  const mockTee = formatCounts.get("tee-nitro-v1") ?? 0;
  const verifiedCount = [...formatCounts.values()].reduce((a, b) => a + b, 0);
  console.log(`Summary: ${verifiedCount} verified (real ZK ${real} · demo formats ${demo} · mock TEE ${mockTee}), ${skippedCount} skipped, ${rejected}/${tamperCases.length} tampered results rejected`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "demo failed");
  process.exitCode = 1;
} finally {
  await server.close();
  closeSnarkjsWorker();
  closeNoirWorker();
  await destroyNoir();
}
