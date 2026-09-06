import assert from "node:assert/strict";
import test from "node:test";
import { EXTENSION_ID, VerifiableToolsMeta, expectedCircuitHash } from "@demo/protocol";
import { VerifiableClient } from "@demo/client";
import { expectComplete, withServerOptions } from "./helpers.js";

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

  test("ezkl sidecar /prove rejects a wrong circuitHash with 400", async () => {
    const response = await fetch(`${sidecar}/prove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arguments: { a: 1, b: 2 }, circuitHash: "0x00", inputCommitment: "0x", outputCommitment: "0x", output: "3" }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "circuitHashMismatch" });
  });
}
