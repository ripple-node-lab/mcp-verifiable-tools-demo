import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { VerifiableClient } from "@demo/client";
import { DemoServer } from "@demo/server";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, VerifiableToolsMeta, clientCapabilities, expectedCircuitHash, freshNonce } from "@demo/protocol";
import { DemoSigProver, Prover, ProveInput } from "@demo/prover";
import { DemoSigVerifier, VerificationKeyRegistry, Verifier, VerifyContext } from "@demo/verifier";
import { SidecarProver, SidecarVerifier, sidecarHealth } from "@demo/prover-sidecar";
import { SIDECAR_FORMAT, startMockSidecar } from "@demo/sidecar-mock";
import { expectComplete, rpc, withServerOptions } from "./helpers.js";

async function happyPath(baseUrl: string): Promise<void> {
  const origin = new URL(baseUrl).origin;
  await withServerOptions({
    provers: [new SidecarProver({ baseUrl, format: SIDECAR_FORMAT })],
    formatDescriptors: { [SIDECAR_FORMAT]: (hash) => ({ verificationKeyUri: `${baseUrl}/vk/${hash}` }) }
  }, async (server: DemoServer) => {
    const client = new VerifiableClient(server.mcpUrl, { allowedKeyOrigins: [origin], verifiers: [new SidecarVerifier({ baseUrl, format: SIDECAR_FORMAT })] });
    const discovery = await client.discover();
    assert.ok(discovery.proofFormats.includes(SIDECAR_FORMAT));
    const call = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: SIDECAR_FORMAT });
    const result = expectComplete(call.result);
    const meta = result._meta?.[EXTENSION_ID] as VerifiableToolsMeta;
    assert.equal(meta.proofFormat, SIDECAR_FORMAT);
    assert.equal(meta.verificationKeyUri, `${baseUrl}/vk/${expectedCircuitHash("add")}`);
    const outcome = await client.verify(result, { a: 1, b: 2 }, "add", { nonce: call.nonce });
    assert.deepEqual(outcome, { ok: true });
    // The sidecar's proof also verifies locally in TS (prove elsewhere, verify here).
    const local = new DemoSigVerifier(new VerificationKeyRegistry([origin]), SIDECAR_FORMAT);
    const ctx: VerifyContext = { arguments: { a: 1, b: 2 }, content: result.content, nonce: call.nonce, expectedCircuitHash: expectedCircuitHash("add", SIDECAR_FORMAT), verificationKeyUri: meta.verificationKeyUri };
    assert.equal(await local.verify(meta, ctx), true);
    const tampered = { ...result, content: [{ type: "text" as const, text: "999" }] };
    const tamperedOutcome = await client.verify(tampered, { a: 1, b: 2 }, "add", { nonce: call.nonce });
    assert.equal(tamperedOutcome.ok, false);
    if (!tamperedOutcome.ok) assert.equal(tamperedOutcome.reason, "outputCommitmentMismatch");
  });
}

test("mock sidecar proves and verifies end to end", async () => {
  const sidecar = await startMockSidecar(0);
  try {
    assert.deepEqual(await sidecarHealth(sidecar.url), { status: "ok", formats: [SIDECAR_FORMAT] });
    await happyPath(sidecar.url);
  } finally { await sidecar.close(); }
});

test("a sidecar that alters binding fields produces a JSON-RPC error, never a result", async () => {
  const fake = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/prove") {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ proofFormat: SIDECAR_FORMAT, circuitHash: "0x", inputCommitment: "0xevil", outputCommitment: "0x", proof: "0x00" }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const address = fake.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  try {
    await withServerOptions({ provers: [new SidecarProver({ baseUrl: url, format: SIDECAR_FORMAT })] }, async (server: DemoServer) => {
      const response = await rpc(server, "tools/call", {
        name: "add",
        arguments: { a: 1, b: 2 },
        _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities([SIDECAR_FORMAT], { requireProof: true }), [EXTENSION_ID]: { nonce: freshNonce(), requestedProofFormat: SIDECAR_FORMAT } }
      }, { "Mcp-Name": "add" });
      assert.equal(response.error?.code, -32603);
      assert.equal(response.result, undefined);
    });
  } finally { await new Promise<void>((resolve) => fake.close(() => resolve())); }
});

test("a closed sidecar yields a JSON-RPC error and the server keeps answering discover", async () => {
  const sidecar = await startMockSidecar(0);
  const url = sidecar.url;
  await sidecar.close();
  await withServerOptions({ provers: [new SidecarProver({ baseUrl: url, format: SIDECAR_FORMAT })] }, async (server: DemoServer) => {
    const response = await rpc(server, "tools/call", {
      name: "add",
      arguments: { a: 1, b: 2 },
      _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities([SIDECAR_FORMAT], { requireProof: true }), [EXTENSION_ID]: { nonce: freshNonce(), requestedProofFormat: SIDECAR_FORMAT } }
    }, { "Mcp-Name": "add" });
    assert.equal(response.error?.code, -32603);
    const discovery = await rpc(server, "server/discover", {});
    assert.ok(discovery.result);
  });
});

test("SidecarProver times out on a silent sidecar and aborts on the caller's signal", async () => {
  const hung = createServer(() => { /* never respond */ });
  await new Promise<void>((resolve) => hung.listen(0, "127.0.0.1", resolve));
  const address = hung.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  const prover = new SidecarProver({ baseUrl: url, format: SIDECAR_FORMAT, timeoutMs: 50 });
  const input: ProveInput = { arguments: {}, circuitHash: "0x", inputCommitment: "0x", outputCommitment: "0x", output: "1" };
  try {
    try {
      await prover.prove(input);
      assert.ok(false, "expected timeout error");
    } catch (error: unknown) {
      assert.ok(error instanceof Error && error.message === "sidecar /prove timed out");
    }
    const abort = new AbortController();
    const pending = prover.prove(input, { signal: abort.signal });
    setTimeout(() => abort.abort(), 10);
    try {
      await pending;
      assert.ok(false, "expected AbortError");
    } catch (error: unknown) {
      assert.ok(error instanceof DOMException && (error as DOMException).name === "AbortError");
    }
  } finally { await new Promise<void>((resolve) => hung.close(() => resolve())); }
});

test("SidecarProver rejects with AbortError on an aborted signal", async () => {
  const prover = new SidecarProver({ baseUrl: "http://127.0.0.1:1", format: SIDECAR_FORMAT });
  const input: ProveInput = { arguments: {}, circuitHash: "0x", inputCommitment: "0x", outputCommitment: "0x", output: "1" };
  const abort = new AbortController();
  abort.abort();
  try {
    await prover.prove(input, { signal: abort.signal });
    assert.ok(false, "expected AbortError");
  } catch (error: unknown) {
    assert.ok(error instanceof DOMException && (error as DOMException).name === "AbortError");
  }
});

test("a descriptor-supplied circuitHash is used for proving and verified by the client", async () => {
  const customHash = `0x${"cd".repeat(32)}`;
  class EchoProver implements Prover {
    readonly format = "custom-hash-v1";
    async prove(input: ProveInput): Promise<VerifiableToolsMeta> {
      return { proof: "0x01", proofFormat: this.format, circuitHash: input.circuitHash, inputCommitment: input.inputCommitment, outputCommitment: input.outputCommitment, ...(input.nonce === undefined ? {} : { nonce: input.nonce }) };
    }
  }
  class EchoVerifier implements Verifier {
    readonly format = "custom-hash-v1";
    async verify(meta: VerifiableToolsMeta): Promise<boolean> { return meta.circuitHash === customHash; }
  }
  await withServerOptions({
    provers: [new EchoProver()],
    formatDescriptors: { "custom-hash-v1": () => ({ circuitHash: customHash }) }
  }, async (server: DemoServer) => {
    const client = new VerifiableClient(server.mcpUrl, { verifiers: [new EchoVerifier()] });
    await client.discover();
    const descriptor = client.descriptor("add");
    assert.equal(descriptor?.formats?.["custom-hash-v1"]?.circuitHash, customHash);
    const result = await client.callAndVerify("add", { a: 1, b: 2 }, "custom-hash-v1");
    const meta = result._meta?.[EXTENSION_ID] as VerifiableToolsMeta;
    assert.equal(meta.circuitHash, customHash);
  });
});

test("server rejects extra provers that collide with a built-in format", async () => {
  assert.throws(() => new DemoServer({ provers: [new DemoSigProver()] }), /duplicate prover format/);
  assert.throws(() => new DemoServer({ provers: [new DemoSigProver("tee-nitro-v1")] }), /duplicate prover format/);
});

if (process.env.SIDECAR_URL) {
  test("external sidecar (SIDECAR_URL) happy path", async () => {
    assert.deepEqual(await sidecarHealth(process.env.SIDECAR_URL!), { status: "ok", formats: [SIDECAR_FORMAT] });
    await happyPath(process.env.SIDECAR_URL!);
  });
}
