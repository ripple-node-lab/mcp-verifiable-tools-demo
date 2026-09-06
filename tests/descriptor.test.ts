import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { expectedCircuitHash } from "@demo/protocol";
import { withServer, withServerOptions } from "./helpers.js";
test("discovery stores and validates descriptors", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  assert.equal(client.descriptor("add")?.proofPolicy, "always");
}));
test("descriptor circuit hash mismatch is rejected", async () => withServerOptions({ descriptorOverride: (tool, descriptor) => tool === "add" ? { ...descriptor, circuitHash: expectedCircuitHash("riskScore") } : descriptor }, async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await assert.rejects(() => client.discover());
}));
test("descriptor-less tools are allowed", async () => withServerOptions({ descriptorOverride: (tool, descriptor) => tool === "add" ? undefined : descriptor }, async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  assert.equal(client.descriptor("add"), undefined);
}));
test("per-format descriptor circuit hashes are pinned", async () => {
  await assert.rejects(() => withServerOptions({
    descriptorOverride: (tool, descriptor) => tool === "add"
      ? { ...descriptor, formats: { ...descriptor.formats, "demo-sig-v1": { circuitHash: expectedCircuitHash("riskScore", "demo-sig-v1") } } }
      : descriptor
  }, async (server) => new VerifiableClient(server.mcpUrl).discover()));
  await withServerOptions({
    descriptorOverride: (tool, descriptor) => tool === "add"
      ? { ...descriptor, formats: { ...descriptor.formats, "demo-sig-v1": { circuitHash: expectedCircuitHash(tool, "demo-sig-v1") } } }
      : descriptor
  }, async (server) => {
    await new VerifiableClient(server.mcpUrl).discover();
  });
});
