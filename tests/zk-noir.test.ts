import assert from "node:assert/strict";
import test from "node:test";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, clientCapabilities, expectedCircuitHash } from "@demo/protocol";
import { VerifiableClient } from "@demo/client";
import { waitForControllersGone, waitForTaskWorking, withServer, withServerOptions, expectComplete, expectTask, rpc } from "./helpers.js";

test("noir-v1 proves and verifies add results", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "noir-v1" });
    const result = expectComplete(call.result);
    assert.equal((await client.verify(result, { a: 20, b: 22 }, "add", { nonce: call.nonce })).ok, true);
    assert.equal(result._meta?.[EXTENSION_ID]?.proofFormat, "noir-v1");
    assert.equal(result._meta?.[EXTENSION_ID]?.circuitHash, expectedCircuitHash("add", "noir-v1"));
    assert.deepEqual(result._meta?.[EXTENSION_ID]?.publicInputs?.slice(3), [
      "0x0000000000000000000000000000000000000000000000000000000000000014",
      "0x0000000000000000000000000000000000000000000000000000000000000016",
      "0x000000000000000000000000000000000000000000000000000000000000002a"
    ]);
  });
});

test("noir-v1 rejects changed content and native inputs", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "noir-v1" });
    const result = expectComplete(call.result);
    result.content[0].text = "43";
    assert.deepEqual(await client.verify(result, { a: 20, b: 22 }, "add", { nonce: call.nonce }), { ok: false, reason: "outputCommitmentMismatch" });
    result.content[0].text = "42";
    result._meta![EXTENSION_ID]!.publicInputs![5] = "0x2b";
    assert.deepEqual(await client.verify(result, { a: 20, b: 22 }, "add", { nonce: call.nonce }), { ok: false, reason: "proofInvalid" });
  });
});

test("noir-v1 rejects a corrupted publicInputs binding head", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "noir-v1" });
    const result = expectComplete(call.result);
    result._meta![EXTENSION_ID]!.publicInputs![0] = "0xdeadbeef";
    assert.deepEqual(await client.verify(result, { a: 20, b: 22 }, "add", { nonce: call.nonce }), { ok: false, reason: "proofInvalid" });
  });
});

test("noir-v1 rejects a proof for different native inputs", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const first = expectComplete((await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "noir-v1" })).result);
    const secondCall = await client.callTool("add", { a: 21, b: 22 }, { proofFormat: "noir-v1" });
    const second = expectComplete(secondCall.result);
    second._meta![EXTENSION_ID]!.proof = first._meta![EXTENSION_ID]!.proof;
    assert.deepEqual(await client.verify(second, { a: 21, b: 22 }, "add", { nonce: secondCall.nonce }), { ok: false, reason: "proofInvalid" });
  });
});

test("noir-v1 rejects wrong verification-key bytes", async () => {
  await withServerOptions({ verificationKeyOverrides: { [expectedCircuitHash("add", "noir-v1")]: "{}" } }, async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "noir-v1" });
    assert.deepEqual(await client.verify(expectComplete(call.result), { a: 20, b: 22 }, "add", { nonce: call.nonce }), { ok: false, reason: "proofInvalid" });
  });
});

test("noir-v1 rejects out-of-range and non-integer arguments", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    await assert.rejects(() => client.callTool("add", { a: 0x100000000, b: 22 }, { proofFormat: "noir-v1" }));
    await assert.rejects(() => client.callTool("add", { a: 1.5, b: 22 }, { proofFormat: "noir-v1" }));
    const overflow = await rpc(server, "tools/call", {
      name: "add",
      arguments: { a: 0xffffffff, b: 1 },
      _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["noir-v1"]) }
    }, { "Mcp-Name": "add" });
    assert.equal(overflow.error?.code, -32602);
  });
});

test("noir-v1 task proving can be cancelled", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats }, true);
    const call = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: "noir-v1" });
    const task = expectTask(call.result);
    await waitForTaskWorking(server, task.taskId);
    const cancelled = await rpc(server, "tasks/cancel", { taskId: task.taskId });
    assert.equal(cancelled.result?.status, "cancelled");
    await waitForControllersGone(server);
    assert.equal(server.tasks.controllerCount, 0);
  });
});
