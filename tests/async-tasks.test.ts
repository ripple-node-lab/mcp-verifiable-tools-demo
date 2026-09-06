import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { TaskStore } from "@demo/server";
import { clientCapabilities, JsonRpcProtocolError, META_CLIENT_CAPABILITIES } from "@demo/protocol";
import { withServer, withServerOptions, rpc, expectTask } from "./helpers.js";
test("riskScore is synchronous without tasks and asynchronous with tasks", async () => withServer(async (server) => {
  const plain = await rpc(server, "tools/call", { name: "riskScore", arguments: { symbol: "AAPL" }, _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"]) } }, { "Mcp-Name": "riskScore" });
  assert.equal(plain.result?.resultType, "complete");
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"] }, true);
  const task = expectTask((await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1" })).result);
  const intermediate = await rpc(server, "tasks/get", { taskId: task.taskId });
  assert.equal(intermediate.result?.resultType, "complete");
  assert.equal(["working", "completed"].includes(String(intermediate.result?.status)), true);
  const cancellable = expectTask((await client.callTool("riskScore", { symbol: "MSFT" }, { proofFormat: "demo-sig-v1" })).result);
  const cancelled = await rpc(server, "tasks/cancel", { taskId: cancellable.taskId });
  assert.equal(cancelled.result?.status, "cancelled");
  const result = await client.callAndVerify("riskScore", { symbol: "AAPL" }, "demo-sig-v1");
  assert.equal(result.content[0].text, "72");
}));
test("tasks cancel aborts the producer and remains cancelled", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"] }, true);
  const call = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1" });
  const task = expectTask(call.result);
  const cancelled = await rpc(server, "tasks/cancel", { taskId: task.taskId });
  assert.equal(cancelled.result?.status, "cancelled");
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  const later = await rpc(server, "tasks/get", { taskId: task.taskId });
  assert.equal(later.result?.status, "cancelled");
}));
test("completed tasks expire from the task store", async () => {
  const store = new TaskStore({ ttlMs: 10 });
  const task = store.create(async () => ({ resultType: "complete", content: [{ type: "text", text: "ok" }], isError: false }));
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(store.get(task.taskId), undefined);
});
test("synchronous task producer failures mark the task failed", async () => {
  const store = new TaskStore();
  const task = store.create(() => { throw new Error("synchronous failure"); });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(store.get(task.taskId)?.status, "failed");
  assert.equal(store.get(task.taskId)?.error?.message, "synchronous failure");
});
test("task failures preserve JSON-RPC protocol errors", async () => {
  const store = new TaskStore();
  const task = store.create(async () => { throw new JsonRpcProtocolError(-32602, "invalid arguments", { field: "a" }); });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(store.get(task.taskId)?.error, { code: -32602, message: "invalid arguments", data: { field: "a" } });
});
test("tasks-declared ZK calls reject invalid add arguments immediately", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", {
    name: "add",
    arguments: { a: -1, b: 2 },
    _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["snarkjs-v2"], { tasks: true }) }
  }, { "Mcp-Name": "add" });
  assert.equal(response.error?.code, -32602);
  assert.equal(server.tasks.controllerCount, 0);
}));
test("working tasks abort when their TTL expires", async () => {
  const store = new TaskStore({ ttlMs: 10 });
  let aborted = false;
  const task = store.create(async (signal) => await new Promise((resolve) => {
    signal.addEventListener("abort", () => { aborted = true; resolve({ resultType: "complete", content: [{ type: "text", text: "aborted" }], isError: false }); }, { once: true });
  }));
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(store.get(task.taskId)?.status, "failed");
  assert.equal(aborted, true);
});
test("task TTL covers the risc0 proving timeout when the sidecar is configured", async () => {
  await withServerOptions({ risc0SidecarUrl: "http://127.0.0.1:1", risc0TimeoutMs: 120_000 }, async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    await client.discover();
    client.setCapabilities({ proofFormats: ["demo-sig-v1"] }, true);
    const task = expectTask((await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1" })).result);
    assert.equal(task.ttlMs, 150_000);
    await rpc(server, "tasks/cancel", { taskId: task.taskId });
  });
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    await client.discover();
    client.setCapabilities({ proofFormats: ["demo-sig-v1"] }, true);
    const task = expectTask((await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1" })).result);
    assert.equal(task.ttlMs, 60_000);
    await rpc(server, "tasks/cancel", { taskId: task.taskId });
  });
});
