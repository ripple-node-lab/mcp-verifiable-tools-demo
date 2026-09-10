import assert from "node:assert/strict";
import test from "node:test";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, clientCapabilities, expectedCircuitHash } from "@demo/protocol";
import { VerifiableClient } from "@demo/client";
import { rpc, waitForControllersGone, waitForTaskWorking, withServer, withServerOptions, expectComplete, expectTask } from "./helpers.js";

test("snarkjs-v2 proves and verifies add results", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "snarkjs-v2" });
    const result = expectComplete(call.result);
    assert.equal((await client.verify(result, { a: 20, b: 22 }, "add", { nonce: call.nonce })).ok, true);
    const meta = result._meta?.[EXTENSION_ID];
    assert.equal(meta?.proofFormat, "snarkjs-v2");
    assert.equal(meta?.circuitHash, expectedCircuitHash("add", "snarkjs-v2"));
    assert.deepEqual(meta?.publicInputs?.slice(3), ["42", "20", "22"]);
  });
});

test("snarkjs-v2 rejects changed content and native inputs", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "snarkjs-v2" });
    const result = expectComplete(call.result);
    result.content[0].text = "43";
    assert.deepEqual(await client.verify(result, { a: 20, b: 22 }, "add", { nonce: call.nonce }), { ok: false, reason: "outputCommitmentMismatch" });
    result.content[0].text = "42";
    result._meta![EXTENSION_ID]!.publicInputs![3] = "43";
    assert.deepEqual(await client.verify(result, { a: 20, b: 22 }, "add", { nonce: call.nonce }), { ok: false, reason: "proofInvalid" });
  });
});

test("snarkjs-v2 rejects a corrupted publicInputs binding head", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "snarkjs-v2" });
    const result = expectComplete(call.result);
    result._meta![EXTENSION_ID]!.publicInputs![0] = "0xdeadbeef";
    assert.deepEqual(await client.verify(result, { a: 20, b: 22 }, "add", { nonce: call.nonce }), { ok: false, reason: "proofInvalid" });
  });
});

test("snarkjs-v2 rejects a proof for different native inputs", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const first = expectComplete((await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "snarkjs-v2" })).result);
    const secondCall = await client.callTool("add", { a: 21, b: 22 }, { proofFormat: "snarkjs-v2" });
    const second = expectComplete(secondCall.result);
    second._meta![EXTENSION_ID]!.proof = first._meta![EXTENSION_ID]!.proof;
    assert.deepEqual(await client.verify(second, { a: 21, b: 22 }, "add", { nonce: secondCall.nonce }), { ok: false, reason: "proofInvalid" });
  });
});

test("snarkjs-v2 rejects wrong verification-key bytes", async () => {
  await withServerOptions({ verificationKeyOverrides: { [expectedCircuitHash("add", "snarkjs-v2")]: "{}" } }, async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "snarkjs-v2" });
    assert.deepEqual(await client.verify(expectComplete(call.result), { a: 20, b: 22 }, "add", { nonce: call.nonce }), { ok: false, reason: "proofInvalid" });
  });
});

test("snarkjs-v2 rejects out-of-range and non-integer arguments", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    await assert.rejects(() => client.callTool("add", { a: -1, b: 22 }, { proofFormat: "snarkjs-v2" }));
    await assert.rejects(() => client.callTool("add", { a: 1.5, b: 22 }, { proofFormat: "snarkjs-v2" }));
    const overflow = await rpc(server, "tools/call", {
      name: "add",
      arguments: { a: 0xffffffff, b: 1 },
      _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["snarkjs-v2"]) }
    }, { "Mcp-Name": "add" });
    assert.equal(overflow.error?.code, -32602);
  });
});

test("snarkjs-v2 task proving can be cancelled", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats }, true);
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "snarkjs-v2" });
    const task = expectTask(call.result);
    await waitForTaskWorking(server, task.taskId);
    const cancelled = await rpc(server, "tasks/cancel", { taskId: task.taskId });
    assert.equal(cancelled.result?.status, "cancelled");
    await waitForControllersGone(server);
    assert.equal(server.tasks.controllerCount, 0);
  });
});

test("demo formats accept a u32 sum overflow", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    for (const format of ["demo-sig-v1", "demo-commit-v1"]) {
      const call = await client.callTool("add", { a: 0xffffffff, b: 1 }, { proofFormat: format });
      assert.equal(expectComplete(call.result).content[0].text, "4294967296");
    }
  });
});
