import assert from "node:assert/strict";
import test from "node:test";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, VerifiableToolsMeta, clientCapabilities, expectedCircuitHash } from "@demo/protocol";
import { VerifiableClient } from "@demo/client";
import { expectComplete, rpc, withServerOptions } from "./helpers.js";

const SIDECAR_URL = process.env.EZKL_SIDECAR_URL;
const EZKL_HASH = expectedCircuitHash("add", "ezkl-v1");

if (!SIDECAR_URL) {
  console.log("skipping ezkl sidecar tests (EZKL_SIDECAR_URL unset)");
} else {
  const sidecar = SIDECAR_URL;
  test("ezkl sidecar /healthz reports the pinned circuit hash", async () => {
    const response = await fetch(`${sidecar}/healthz`);
    assert.equal(response.status, 200);
    const health = await response.json() as { formats: string[]; circuitHash: string };
    assert.deepEqual(health.formats, ["ezkl-v1"]);
    assert.equal(health.circuitHash, EZKL_HASH);
  });

  test("ezkl sidecar proves add and the client verifies in-process", async () => {
    await withServerOptions({ ezklSidecarUrl: sidecar }, async (server) => {
      const client = new VerifiableClient(server.mcpUrl);
      const discovery = await client.discover();
      assert.ok(discovery.proofFormats.includes("ezkl-v1"));
      const call = await client.callTool("add", { a: 2, b: 40 }, { proofFormat: "ezkl-v1" });
      const result = expectComplete(call.result);
      const meta = result._meta?.[EXTENSION_ID] as VerifiableToolsMeta;
      assert.equal(meta.proofFormat, "ezkl-v1");
      assert.equal(meta.circuitHash, EZKL_HASH);
      assert.deepEqual(meta.publicInputs?.slice(3), ["42", "2", "40"]);
      const outcome = await client.verify(result, { a: 2, b: 40 }, "add", { nonce: call.nonce });
      assert.deepEqual(outcome, { ok: true });
      // the sidecar's own /verify agrees
      const response = await fetch(`${sidecar}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meta, expectedCircuitHash: EZKL_HASH }) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    });
  });

  test("ezkl-v1 boundary: a=2^24,b=2^24 proves and verifies end-to-end", async () => {
    const args = { a: 16777216, b: 16777216 };
    await withServerOptions({ ezklSidecarUrl: sidecar }, async (server) => {
      const client = new VerifiableClient(server.mcpUrl);
      await client.discover();
      const call = await client.callTool("add", args, { proofFormat: "ezkl-v1" });
      const result = expectComplete(call.result);
      const meta = result._meta?.[EXTENSION_ID] as VerifiableToolsMeta;
      assert.equal(result.content[0].text, "33554432");
      assert.deepEqual(meta.publicInputs?.slice(3), ["33554432", "16777216", "16777216"]);
      const outcome = await client.verify(result, args, "add", { nonce: call.nonce });
      assert.deepEqual(outcome, { ok: true });
    });
  });

  test("ezkl-v1 rejects a=2^24+1 at the server with -32602", async () => {
    await withServerOptions({ ezklSidecarUrl: sidecar }, async (server) => {
      const response = await rpc(server, "tools/call", {
        name: "add",
        arguments: { a: 16777217, b: 0 },
        _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["ezkl-v1"]) }
      }, { "Mcp-Name": "add" });
      assert.equal(response.error?.code, -32602);
    });
  });

  test("ezkl sidecar /prove rejects inputs > 2^24 with 400", async () => {
    const response = await fetch(`${sidecar}/prove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arguments: { a: 16777217, b: 0 }, circuitHash: EZKL_HASH, inputCommitment: "0x", outputCommitment: "0x", output: "16777217" }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalidArguments" });
  });

  test("ezkl sidecar /prove rejects a wrong circuitHash with 400", async () => {
    const response = await fetch(`${sidecar}/prove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arguments: { a: 1, b: 2 }, circuitHash: "0x00", inputCommitment: "0x", outputCommitment: "0x", output: "3" }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "circuitHashMismatch" });
  });
}
