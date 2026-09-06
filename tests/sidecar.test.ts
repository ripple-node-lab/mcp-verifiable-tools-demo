import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { VerifiableClient } from "@demo/client";
import { DemoServer } from "@demo/server";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, VerifiableToolsMeta, clientCapabilities, expectedCircuitHash, freshNonce } from "@demo/protocol";
import { ProveInput } from "@demo/prover";
import { DemoSigVerifier, VerificationKeyRegistry, VerifyContext } from "@demo/verifier";
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

test("SidecarProver rejects with AbortError on an aborted signal", async () => {
  const prover = new SidecarProver({ baseUrl: "http://127.0.0.1:1", format: SIDECAR_FORMAT });
  const input: ProveInput = { circuitHash: "0x", inputCommitment: "0x", outputCommitment: "0x", output: "1" };
  const abort = new AbortController();
  abort.abort();
  try {
    await prover.prove(input, { signal: abort.signal });
    assert.ok(false, "expected AbortError");
  } catch (error: unknown) {
    assert.ok(error instanceof DOMException && (error as DOMException).name === "AbortError");
  }
});

if (process.env.SIDECAR_URL) {
  test("external sidecar (SIDECAR_URL) happy path", async () => {
    assert.deepEqual(await sidecarHealth(process.env.SIDECAR_URL!), { status: "ok", formats: [SIDECAR_FORMAT] });
    await happyPath(process.env.SIDECAR_URL!);
  });
}
