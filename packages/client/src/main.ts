import { startServer } from "@demo/server";
import { closeProverWorker as closeNoirWorker, destroy as destroyNoir } from "@demo/prover-noir";
import { closeProverWorker as closeSnarkjsWorker } from "@demo/prover-snarkjs";
import { createInterface } from "node:readline";
import { VerifiableClient } from "./client.js";
import { TlsnProvenanceVerifier } from "@demo/prover-sidecar";
import { CallToolResult, EXTENSION_ID, freshNonce, JsonValue, VerifiableToolsMeta } from "@demo/protocol";

const verbose = process.env.DEMO_VERBOSE !== "0";
const color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
const paint = (code: number, text: string): string => (color ? `[${code}m${text}[0m` : text);
const GREEN = 32, RED = 31, YELLOW = 33, MAGENTA = 35, DIM = 2;

// Indented detail fields, padded to a common label width (verbose only).
const field = (label: string, text: string): string => `   ${(label + ":").padEnd(10)} ${text}`;
const title = (name: string, format?: string): void => { if (verbose) console.log(format ? `${name} (${format})` : name); };
const narrate = (text: string): void => { if (verbose) console.log(field("what", text)); };
const resultLine = (name: string, text: string, skipped = false): void => {
  const rendered = skipped ? paint(DIM, text) : paint(GREEN, text);
  console.log(verbose ? field("result", rendered) : `${name}: ${rendered}`);
};
const means = (text: string): void => { if (verbose) console.log(field("means", text)); };
const enable = (text: string): void => { if (verbose) console.log(field("enable", text)); };
const evidence = (text: string): void => { if (verbose) console.log(field("evidence", text)); };
const gap = (): void => { if (verbose) console.log(); };
const section = (name: string): void => { if (verbose) console.log(`\n── ${name} ──`); };
let stepInterface: ReturnType<typeof createInterface> | undefined;
let stepClosed = false;
let pendingStep: (() => void) | undefined;
const pause = async (label: string): Promise<void> => {
  if (process.env.DEMO_PAUSE !== "1" || !process.stdin.isTTY || stepClosed) return;
  if (!stepInterface) {
    stepInterface = createInterface({ input: process.stdin, output: process.stdout });
    // One permanent listener: stdin close (Ctrl-D) releases the pending prompt so the demo never hangs.
    stepInterface.on("close", () => { stepClosed = true; pendingStep?.(); });
  }
  await new Promise<void>((resolve) => {
    const finish = (): void => { pendingStep = undefined; resolve(); };
    pendingStep = finish;
    stepInterface!.question(`   ${label}`, finish);
  });
};
const printChecks = (result: CallToolResult, extra?: string): void => {
  console.log(verbose ? field("checks", checksLine(result, extra)) : `   checks: ${checksLine(result, extra)}`);
};

// `0x` + first 8 hex chars + ellipsis.
const short = (hex: unknown): string => (typeof hex === "string" && hex.startsWith("0x") ? `${hex.slice(0, 10)}…` : String(hex));
// Byte length of meta.proof: `0x`-hex for demo-sig/noir/tee, base64url for snarkjs/risc0/ezkl.
function proofByteLength(meta: VerifiableToolsMeta): number {
  const proof = meta?.proof;
  if (typeof proof !== "string") return 0;
  return Buffer.from(proof.startsWith("0x") ? proof.slice(2) : proof, proof.startsWith("0x") ? "hex" : "base64url").byteLength;
}

// The checks verifyResult performed, in its order. Reaching this line means
// every check passed.
function checksLine(result: CallToolResult, extra?: string): string {
  const meta = result._meta?.[EXTENSION_ID];
  const hash = typeof meta?.circuitHash === "string" && meta.circuitHash.startsWith("0x") ? meta.circuitHash.slice(0, 10) : String(meta?.circuitHash);
  const attestation = meta?.inputAttestations?.[0];
  const provenance = attestation ? ` · provenance=ok (${attestation.type})` : "";
  return `circuitHash=${hash}… (pinned client-side) · inputCommitment=ok · outputCommitment=ok · nonce=ok · proof=ok (${meta?.proofFormat})${provenance}${extra ?? ""}`;
}

type Class = "REAL" | "DEMO" | "MOCK";
const CLS: Record<string, Class> = {
  "snarkjs-v2": "REAL", "noir-v1": "REAL", "risc0-v1": "REAL", "ezkl-v1": "REAL",
  "demo-sig-v1": "DEMO", "demo-commit-v1": "DEMO", "tee-nitro-v1": "MOCK"
};
const CLS_COLOR: Record<string, number> = { REAL: GREEN, DEMO: YELLOW, MOCK: MAGENTA };
interface Row { n: number; scenario: string; result: string; format: string; cls: Class | "-"; provenance: string }

const server = await startServer({
  port: 0,
  risc0SidecarUrl: process.env.RISC0_SIDECAR_URL,
  risc0TimeoutMs: process.env.RISC0_SIDECAR_TIMEOUT_MS ? Number(process.env.RISC0_SIDECAR_TIMEOUT_MS) : undefined,
  ezklSidecarUrl: process.env.EZKL_SIDECAR_URL,
  tlsnSidecarUrl: process.env.TLSN_SIDECAR_URL,
});
try {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) {
    throw new Error(`Node.js 20 or later is required (running ${process.version}); see README Quick start`);
  }
  const tlsnOrigin = process.env.TLSN_SIDECAR_URL ? new URL(process.env.TLSN_SIDECAR_URL).origin : undefined;
  const client = new VerifiableClient(server.mcpUrl, { allowedKeyOrigins: tlsnOrigin ? [tlsnOrigin] : [] });
  if (process.env.TLSN_SIDECAR_URL) client.addProvenanceVerifier(new TlsnProvenanceVerifier({ baseUrl: process.env.TLSN_SIDECAR_URL }));
  const rows: Row[] = [];
  let skippedCount = 0;
  const sidecars = ["RISC0_SIDECAR_URL", "EZKL_SIDECAR_URL", "TLSN_SIDECAR_URL"].filter((name) => process.env[name]);
  section("Setup");
  if (verbose) {
    console.log(`MCP verifiable-tools demo — server runs in-process as an UNTRUSTED operator; the client
verifies each result against keys/roots pinned locally by circuitHash (never fetched from the server).
Evidence travels in CallToolResult._meta["${EXTENSION_ID}"]. Node ${process.version}; sidecars: ${sidecars.length ? sidecars.join(", ") : "none (scenarios 8-10 skipped)"}`);
    console.log();
    console.log(`   checks legend:
     circuitHash      identifies the circuit/key; the client looks up its PINNED verification key/root by this hash (never trusts one sent by the server)
     inputCommitment  H(salt || JCS(arguments)) recomputed by the client from the arguments it sent; must equal the value the proof binds
     outputCommitment H(JCS(content)) recomputed from the returned content; must equal the value the proof binds
     nonce            client-chosen fresh value echoed inside the proof (replay protection)
     proof            verified against the pinned key / verification key; REAL formats also prove the computation, DEMO formats only sign
     provenance       inputAttestations (oracle signature / TLSNotary) verified against pinned keys and bound into publicInputs`);
  }
  section("Scenarios");
  const discovery = await client.discover();

  await pause("[Enter to run scenario 1]");
  title("1. sync add", "demo-sig-v1");
  narrate("sync tools/call for add(20,22) with proofFormat demo-sig-v1; client supplies a fresh nonce");
  const addCall = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "demo-sig-v1" });
  if (addCall.result.resultType !== "complete") throw new Error("unexpected add task");
  const addOutcome = await client.verify(addCall.result, { a: 20, b: 22 }, "add", { nonce: addCall.nonce });
  if (!addOutcome.ok) throw new Error(`demo-sig-v1 verification failed: ${addOutcome.reason}`);
  resultLine("1. sync add", `${addCall.result.content[0].text} (verified demo-sig-v1)`);
  printChecks(addCall.result);
  {
    const meta = addCall.result._meta![EXTENSION_ID]!;
    evidence(`inputCommitment=${short(meta.inputCommitment)} outputCommitment=${short(meta.outputCommitment)} nonce=${short(meta.nonce)} proof=${proofByteLength(meta)} B`);
  }
  means("server signed (result, commitments, nonce) with a key pinned by circuitHash. demo-sig-v1 is a DEMO format: it proves origin and freshness, NOT that 20+22 was computed correctly.");
  rows.push({ n: 1, scenario: "sync add", result: addCall.result.content[0].text, format: "demo-sig-v1", cls: CLS["demo-sig-v1"] ?? "-", provenance: "-" });
  gap();

  client.setCapabilities({ proofFormats: discovery.proofFormats }, true);
  await pause("[Enter to run scenario 2]");
  title("2. async riskScore", "demo-commit-v1");
  narrate(process.env.TLSN_SIDECAR_URL
    ? "riskScore(AAPL) runs as an MCP Task (tasks/get polling); result carries a TLSNotary presentation of the upstream HTTPS response as provenance"
    : "riskScore(AAPL) runs as an MCP Task (tasks/get polling); result carries an oracle-sig-v1 attestation for the upstream price it used");
  const riskCall = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-commit-v1" });
  const risk = riskCall.result.resultType === "task" ? await client.poll(riskCall.result) : riskCall.result;
  if (risk.resultType !== "complete") throw new Error("unexpected riskScore task");
  const riskOutcome = await client.verify(risk, { symbol: "AAPL" }, "riskScore", { nonce: riskCall.nonce });
  if (!riskOutcome.ok) throw new Error(`riskScore verification failed: ${riskOutcome.reason}`);
  const riskProvenance = risk._meta?.[EXTENSION_ID]?.inputAttestations?.[0]?.type ?? "none";
  resultLine("2. async riskScore", `${risk.content[0].text} (verified demo-commit-v1 · provenance ${riskProvenance})`);
  printChecks(risk);
  {
    const meta = risk._meta![EXTENSION_ID]!;
    evidence(`inputCommitment=${short(meta.inputCommitment)} outputCommitment=${short(meta.outputCommitment)} nonce=${short(meta.nonce)} proof=${proofByteLength(meta)} B attestation=${riskProvenance}`);
  }
  means(riskProvenance === "zktls-tlsn-v1"
    ? "REAL zkTLS provenance bound into publicInputs; demo-commit-v1 is still a DEMO format"
    : "the attestation commitment is bound into publicInputs, so the proof covers WHICH input the server used, and the oracle key is pinned by URI. demo-commit-v1 is a DEMO format.");
  rows.push({ n: 2, scenario: "async riskScore", result: risk.content[0].text, format: "demo-commit-v1", cls: CLS["demo-commit-v1"] ?? "-", provenance: riskProvenance });
  gap();

  client.setCapabilities({ proofFormats: discovery.proofFormats, blindExecution: true });
  await pause("[Enter to run scenario 3]");
  title("3. blind privateCreditCheck", "demo-sig-v1");
  narrate("privateCreditCheck(income, debt) via verifiable-tools/call: arguments HPKE-encrypted to the tool key, inputCommitment salted; reply encrypted back");
  let encryptedBytes = 0, encryptedPrefix = "";
  const credit = await client.blindCall({ income: 100000, debt: 30000 }, {
    encryptReply: true,
    onEncrypted: (info) => { encryptedBytes = info.encryptedArgumentsBytes; encryptedPrefix = info.encryptedArgumentsPrefixHex; }
  });
  resultLine("3. blind privateCreditCheck", `${credit.content[0].text} (verified demo-sig-v1)`);
  printChecks(credit, " · args=HPKE-encrypted (salted inputCommitment)");
  {
    const meta = credit._meta![EXTENSION_ID]!;
    evidence(`inputCommitment=${short(meta.inputCommitment)} outputCommitment=${short(meta.outputCommitment)} nonce=${short(meta.nonce)} proof=${proofByteLength(meta)} B ciphertext=${encryptedPrefix}… (${encryptedBytes} B)`);
  }
  means(`server saw only inputCommitment + ${encryptedBytes} bytes of HPKE ciphertext (no plaintext income/debt); the client verified the result against ITS salted commitment, so the result is for exactly the encrypted arguments. Confidentiality relies on the enclave/prover holding the tool key (demo: same process).`);
  rows.push({ n: 3, scenario: "blind privateCreditCheck", result: credit.content[0].text, format: "demo-sig-v1", cls: CLS["demo-sig-v1"] ?? "-", provenance: "-" });
  gap();

  await pause("[Enter to run scenario 4]");
  title("4. deferred priceQuote", "demo-sig-v1");
  narrate("priceQuote(AAPL) returns immediately with a resultId and no proof; client fetches the proof later with verifiable-tools/prove");
  const deferred = await client.callTool("priceQuote", { symbol: "AAPL" });
  if (deferred.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const resultId = deferred.result._meta?.[EXTENSION_ID]?.resultId;
  if (!resultId) throw new Error("missing deferred resultId");
  const proved = await client.prove(resultId);
  if (proved.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const verified = await client.verify(proved.result, { symbol: "AAPL" }, "priceQuote", { nonce: proved.nonce });
  if (!verified.ok) throw new Error(`deferred verification failed: ${verified.reason}`);
  resultLine("4. deferred priceQuote", `${proved.result.content[0].text} (verified ${proved.result._meta?.[EXTENSION_ID]?.proofFormat})`);
  printChecks(proved.result, " · via verifiable-tools/prove");
  {
    const meta = proved.result._meta![EXTENSION_ID]!;
    evidence(`inputCommitment=${short(meta.inputCommitment)} outputCommitment=${short(meta.outputCommitment)} nonce=${short(meta.nonce)} proof=${proofByteLength(meta)} B resultId=${resultId}`);
  }
  means("proof generation is decoupled from the tool call; the deferred proof binds to the original result via resultId + commitments.");
  rows.push({ n: 4, scenario: "deferred priceQuote", result: proved.result.content[0].text, format: "demo-sig-v1", cls: CLS["demo-sig-v1"] ?? "-", provenance: "-" });
  gap();

  await pause("[Enter to run scenario 5]");
  title("5. tee add", "tee-nitro-v1");
  narrate("add(1,2) with tee-nitro-v1: result comes with an AWS Nitro-style attestation document (COSE_Sign1, PCRs, userData)");
  const teeCall = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "tee-nitro-v1" });
  if (teeCall.result.resultType !== "complete") throw new Error("unexpected tee task");
  const teeOutcome = await client.verify(teeCall.result, { a: 1, b: 2 }, "add", { nonce: teeCall.nonce });
  if (!teeOutcome.ok) throw new Error(`tee-nitro-v1 verification failed: ${teeOutcome.reason}`);
  const tee = teeCall.result;
  resultLine("5. tee add", `${tee.content[0].text} (verified tee-nitro-v1)`);
  printChecks(tee);
  {
    const meta = tee._meta![EXTENSION_ID]!;
    evidence(`inputCommitment=${short(meta.inputCommitment)} outputCommitment=${short(meta.outputCommitment)} nonce=${short(meta.nonce)} proof=${proofByteLength(meta)} B teeAttestation=${typeof meta.teeAttestation === "string" ? Buffer.from(meta.teeAttestation.slice(2), "hex").byteLength : 0} B`);
  }
  means("client checked the attestation cert chain to the pinned root, pinned PCRs, nonce, and userData = hash of the tool's HPKE key; the enclave key certified there signed the commitments. MOCK attestation: root/PCR fixtures are generated locally, not from real Nitro hardware.");
  rows.push({ n: 5, scenario: "tee add", result: tee.content[0].text, format: "tee-nitro-v1", cls: CLS["tee-nitro-v1"] ?? "-", provenance: "-" });
  gap();

  client.setCapabilities({ proofFormats: discovery.proofFormats });
  for (const [number, format, label, what, meaning] of [
    [6, "snarkjs-v2", "snarkjs-v2 Groth16", "add(20,22) with snarkjs-v2: REAL Groth16 proof (circom circuit), verified in-process with a pinned verification key", "the proof itself shows 20+22=42 was computed by the pinned circuit. Caveat: single-party trusted setup (demo ceremony)."],
    [7, "noir-v1", "noir-v1 UltraHonk", "add(20,22) with noir-v1: REAL UltraHonk proof (Noir circuit, bb.js), no trusted setup", "same guarantee as 6 without a trusted setup; larger proof."]
  ] as const) {
    const name = `${number}. zk add (${label})`;
    await pause(`[Enter to run scenario ${number}]`);
    title(name);
    narrate(what);
    const proveStart = performance.now();
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: format });
    if (call.result.resultType !== "complete") throw new Error("unexpected ZK task");
    const proveMs = performance.now() - proveStart;
    const verifyStart = performance.now();
    const outcome = await client.verify(call.result, { a: 20, b: 22 }, "add", { nonce: call.nonce });
    const verifyMs = performance.now() - verifyStart;
    if (!outcome.ok) throw new Error(`${format} verification failed: ${outcome.reason}`);
    const meta = call.result._meta![EXTENSION_ID]!;
    const proofBytes = proofByteLength(meta);
    resultLine(name, `${call.result.content[0].text} (verified ${format} · proof ${proofBytes} B · prove ${proveMs.toFixed(0)} ms · verify ${verifyMs.toFixed(0)} ms)`);
    printChecks(call.result);
    evidence(`inputCommitment=${short(meta.inputCommitment)} outputCommitment=${short(meta.outputCommitment)} nonce=${short(meta.nonce)} proof=${proofBytes} B`);
    means(meaning);
    rows.push({ n: number, scenario: `zk add (${label})`, result: call.result.content[0].text, format, cls: CLS[format] ?? "-", provenance: "-" });
    gap();
  }
  for (const [number, format, label, envVar, profile, port, what, meaning] of [
    [8, "risc0-v1", "risc0-v1 sidecar", "RISC0_SIDECAR_URL", "risc0", "4200", "add(20,22) proved in a Rust RISC Zero zkVM sidecar (receipt verified in-process via WASM)", "REAL zkVM receipt: any Rust program, no circuit authoring"],
    [9, "ezkl-v1", "ezkl-v1 sidecar", "EZKL_SIDECAR_URL", "ezkl", "4300", "add(20,22) proved by a Python ezkl ZKML sidecar (verified in-process via @ezkljs/engine)", "REAL ZKML proof over an ONNX model"]
  ] as const) {
    const name = `${number}. zk add (${label})`;
    await pause(`[Enter to run scenario ${number}]`);
    title(name);
    narrate(what);
    if (process.env[envVar]) {
      const proveStart = performance.now();
      const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: format });
      if (call.result.resultType !== "complete") throw new Error(`unexpected ${format} task`);
      const proveMs = performance.now() - proveStart;
      const verifyStart = performance.now();
      const outcome = await client.verify(call.result, { a: 20, b: 22 }, "add", { nonce: call.nonce });
      const verifyMs = performance.now() - verifyStart;
      if (!outcome.ok) throw new Error(`${format} verification failed: ${outcome.reason}`);
      const meta = call.result._meta![EXTENSION_ID]!;
      const proofBytes = proofByteLength(meta);
      resultLine(name, `${call.result.content[0].text} (verified ${format} · proof ${proofBytes} B · prove ${proveMs.toFixed(0)} ms · verify ${verifyMs.toFixed(0)} ms)`);
      printChecks(call.result);
      evidence(`inputCommitment=${short(meta.inputCommitment)} outputCommitment=${short(meta.outputCommitment)} nonce=${short(meta.nonce)} proof=${proofBytes} B`);
      means(meaning);
      rows.push({ n: number, scenario: `zk add (${label})`, result: call.result.content[0].text, format, cls: CLS[format] ?? "-", provenance: "-" });
    } else {
      skippedCount++;
      resultLine(name, `skipped (${envVar} unset)`, true);
      enable(`docker compose --profile ${profile} up --build -d --wait && export ${envVar}=http://127.0.0.1:${port}`);
      means(`if enabled: ${meaning}`);
      rows.push({ n: number, scenario: `zk add (${label})`, result: "skipped", format, cls: CLS[format] ?? "-", provenance: "-" });
    }
    gap();
  }
  {
    const name = "10. zktls riskScore";
    await pause("[Enter to run scenario 10]");
    title(name, "demo-commit-v1");
    narrate("riskScore(AAPL) with a TLSNotary presentation of the upstream HTTPS response as provenance (requireInputProvenance=true)");
    if (process.env.TLSN_SIDECAR_URL) {
      client.setCapabilities({ proofFormats: discovery.proofFormats, requireInputProvenance: true }, true);
      const call = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-commit-v1" });
      const result = call.result.resultType === "task" ? await client.poll(call.result) : call.result;
      if (result.resultType !== "complete") throw new Error("unexpected riskScore task");
      const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce: call.nonce });
      if (!outcome.ok) throw new Error(`tlsn provenance verification failed: ${outcome.reason}`);
      const attestation = result._meta?.[EXTENSION_ID]?.inputAttestations?.[0];
      const proofBytes = typeof attestation?.proof === "string" ? Buffer.from(attestation.proof, "base64url").byteLength : 0;
      resultLine(name, `${result.content[0].text} (verified demo-commit-v1 · provenance ${attestation?.type} · presentation ${proofBytes} B)`);
      printChecks(result);
      const meta = result._meta![EXTENSION_ID]!;
      evidence(`inputCommitment=${short(meta.inputCommitment)} outputCommitment=${short(meta.outputCommitment)} nonce=${short(meta.nonce)} proof=${proofByteLength(meta)} B attestation=${attestation?.type}`);
      means("REAL zkTLS provenance: the upstream response is proven to come from that TLS server, and is bound into publicInputs");
      rows.push({ n: 10, scenario: "zktls riskScore", result: result.content[0].text, format: "demo-commit-v1", cls: CLS["demo-commit-v1"] ?? "-", provenance: attestation?.type ?? "-" });
      client.setCapabilities({ proofFormats: discovery.proofFormats });
    } else {
      skippedCount++;
      resultLine(name, "skipped (TLSN_SIDECAR_URL unset)", true);
      enable("docker compose --profile tlsn up --build -d --wait && export TLSN_SIDECAR_URL=http://127.0.0.1:4400");
      means("if enabled: REAL zkTLS provenance: the upstream response is proven to come from that TLS server, and is bound into publicInputs");
      rows.push({ n: 10, scenario: "zktls riskScore", result: "skipped", format: "demo-commit-v1", cls: CLS["demo-commit-v1"] ?? "-", provenance: "-" });
    }
  }

  // Tamper detection: mutate verified results client-side and re-verify; each
  // mutation must be rejected with the expected reason.
  section("Tamper checks");
  await pause("[Enter for tamper checks]");
  if (!verbose) console.log("Tamper checks (verified results mutated client-side, re-verified):");
  narrate("each verified result is deep-copied client-side, ONE field is changed, and the same verify() runs again; every copy must be rejected");
  type Tamper = { n: number; label: string; hint: string; result: CallToolResult; args: JsonValue; tool: string; nonce: string; mutate?: (result: CallToolResult) => void; reason: string; requireProvenance?: boolean };
  const flipHex = (value: unknown): string => {
    const bytes = Buffer.from(String(value).replace(/^0x/, ""), "hex");
    bytes[bytes.length >> 1] ^= 0xff;
    return `0x${bytes.toString("hex")}`;
  };
  const tamperCases: Tamper[] = [
    { n: 1, label: "output 42 -> 43 (#1):", hint: "outputCommitment recomputed from content no longer matches", result: addCall.result, args: { a: 20, b: 22 }, tool: "add", nonce: addCall.nonce, mutate: (r) => { r.content[0].text = "43"; }, reason: "outputCommitmentMismatch" },
    { n: 1, label: "nonce replaced (#1):", hint: "echoed nonce differs from the one the client sent", result: addCall.result, args: { a: 20, b: 22 }, tool: "add", nonce: freshNonce(), reason: "nonceMismatch" },
    { n: 1, label: "proof byte flipped (#1):", hint: "signature/proof fails against the pinned key", result: addCall.result, args: { a: 20, b: 22 }, tool: "add", nonce: addCall.nonce, mutate: (r) => { r._meta![EXTENSION_ID]!.proof = flipHex(r._meta![EXTENSION_ID]!.proof); }, reason: "proofInvalid" },
    // Stripping the attestation rejects with proofInvalid, not
    // provenanceMissing: the attestation commit is bound into publicInputs, so
    // the proof itself no longer verifies once it is removed.
    { n: 2, label: "provenance stripped (#2):", hint: "attestation commitment is bound into publicInputs, so the proof no longer verifies", result: risk, args: { symbol: "AAPL" }, tool: "riskScore", nonce: riskCall.nonce, mutate: (r) => { delete r._meta![EXTENSION_ID]!.inputAttestations; }, reason: "proofInvalid", requireProvenance: true },
    { n: 5, label: "attestation doc flipped (#5):", hint: "COSE_Sign1 signature over the attestation document fails", result: tee, args: { a: 1, b: 2 }, tool: "add", nonce: teeCall.nonce, mutate: (r) => { r._meta![EXTENSION_ID]!.teeAttestation = flipHex(r._meta![EXTENSION_ID]!.teeAttestation); }, reason: "proofInvalid" }
  ];
  let rejected = 0;
  const tamperTallies = new Map<number, { rejected: number; total: number }>();
  for (const tamper of tamperCases) {
    if (tamper.requireProvenance) client.setCapabilities({ proofFormats: discovery.proofFormats, requireInputProvenance: true }, true);
    const copy = structuredClone(tamper.result);
    tamper.mutate?.(copy);
    const outcome = await client.verify(copy, tamper.args, tamper.tool, { nonce: tamper.nonce });
    if (tamper.requireProvenance) client.setCapabilities({ proofFormats: discovery.proofFormats }, true);
    if (outcome.ok || outcome.reason !== tamper.reason) throw new Error(`tamper check failed: expected ${tamper.reason}, got ${outcome.ok ? "ok" : outcome.reason}`);
    rejected++;
    const tally = tamperTallies.get(tamper.n) ?? { rejected: 0, total: 0 };
    tally.rejected++;
    tally.total++;
    tamperTallies.set(tamper.n, tally);
    const line = `   ${tamper.label.padEnd(30)} ${paint(RED, "rejected")} (${outcome.reason})`;
    console.log(verbose ? `${line}  ← ${tamper.hint}` : line);
  }

  // Summary table: one row per scenario.
  section("Summary");
  const table = rows.map((row) => ({
    n: String(row.n), scenario: row.scenario, result: row.result, format: row.format,
    cls: row.cls, provenance: row.provenance,
    tamper: tamperTallies.has(row.n) ? `${tamperTallies.get(row.n)!.rejected}/${tamperTallies.get(row.n)!.total} rejected` : "-"
  }));
  const header = { n: "#", scenario: "scenario", result: "result", format: "format", cls: "class", provenance: "provenance", tamper: "tamper" };
  const width = (key: keyof typeof header): number => Math.max(header[key].length, ...table.map((row) => row[key].length));
  const renderRow = (row: typeof header): string => {
    const clsCell = row.cls.padEnd(width("cls"));
    const clsCode = CLS_COLOR[row.cls];
    return `${row.n.padEnd(width("n"))}  ${row.scenario.padEnd(width("scenario"))}  ${row.result.padEnd(width("result"))}  ${row.format.padEnd(width("format"))}  ${clsCode === undefined ? clsCell : paint(clsCode, clsCell)}  ${row.provenance.padEnd(width("provenance"))}  ${row.tamper}`;
  };
  console.log(renderRow(header));
  for (const row of table) console.log(renderRow(row));
  if (verbose) console.log("   class: REAL = proof shows the computation itself was done correctly · DEMO = signature only (origin + freshness, not correctness) · MOCK = locally generated attestation fixtures, not real hardware");

  const byClass = (cls: Class): number => rows.filter((row) => row.result !== "skipped" && CLS[row.format] === cls).length;
  const real = byClass("REAL");
  const demo = byClass("DEMO");
  const mockTee = byClass("MOCK");
  const verifiedCount = rows.filter((row) => row.result !== "skipped").length;
  console.log(`Summary: ${verifiedCount} verified (real ZK ${real} · demo formats ${demo} · mock TEE ${mockTee}), ${skippedCount} skipped, ${rejected}/${tamperCases.length} tampered results rejected`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "demo failed");
  process.exitCode = 1;
} finally {
  stepInterface?.close();
  await server.close();
  closeSnarkjsWorker();
  closeNoirWorker();
  await destroyNoir();
}
