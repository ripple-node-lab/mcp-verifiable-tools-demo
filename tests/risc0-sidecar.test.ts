import assert from "node:assert/strict";
import test from "node:test";
import { EXTENSION_ID, VerifiableToolsMeta, expectedCircuitHash } from "@demo/protocol";
import { VerifiableClient } from "@demo/client";
import { expectComplete, withServerOptions } from "./helpers.js";

const SIDECAR_URL = process.env.RISC0_SIDECAR_URL;
const RISC0_HASH = expectedCircuitHash("add", "risc0-v1");

if (!SIDECAR_URL) {
  console.log("skipping risc0 sidecar tests (RISC0_SIDECAR_URL unset)");
} else {
  const sidecar = SIDECAR_URL;
  test("risc0 sidecar /healthz reports the pinned image id", async () => {
    const response = await fetch(`${sidecar}/healthz`);
    assert.equal(response.status, 200);
    const health = await response.json() as { formats: string[]; imageId: string; devMode: boolean };
    assert.deepEqual(health.formats, ["risc0-v1"]);
    assert.equal(health.imageId, RISC0_HASH);
    assert.equal(health.devMode, false);
  });

  test("risc0 sidecar proves add and the client verifies in-process", async () => {
    await withServerOptions({ risc0SidecarUrl: sidecar }, async (server) => {
      const client = new VerifiableClient(server.mcpUrl);
      const discovery = await client.discover();
      assert.ok(discovery.proofFormats.includes("risc0-v1"));
      const call = await client.callTool("add", { a: 2, b: 40 }, { proofFormat: "risc0-v1" });
      const result = expectComplete(call.result);
      const meta = result._meta?.[EXTENSION_ID] as VerifiableToolsMeta;
      assert.equal(meta.proofFormat, "risc0-v1");
      assert.equal(meta.circuitHash, RISC0_HASH);
      assert.deepEqual(meta.publicInputs?.slice(3), ["42", "2", "40"]);
      const outcome = await client.verify(result, { a: 2, b: 40 }, "add", { nonce: call.nonce });
      assert.deepEqual(outcome, { ok: true });
      // the sidecar's own /verify agrees
      const response = await fetch(`${sidecar}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meta, expectedCircuitHash: RISC0_HASH }) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    });
  });

  test("risc0 sidecar /prove rejects a wrong circuitHash with 400", async () => {
    const response = await fetch(`${sidecar}/prove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arguments: { a: 1, b: 2 }, circuitHash: "0x00", inputCommitment: "0x", outputCommitment: "0x", output: "3" }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "circuitHashMismatch" });
  });
}
