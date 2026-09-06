import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { TaskStore } from "@demo/server";
import { withServer, rpc } from "./helpers.js";
test("tasks cancel aborts the producer and remains cancelled", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"] }, true);
  const call = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1" });
  assert.equal(call.result.resultType, "task");
  if (call.result.resultType !== "task") return;
  const cancelled = await rpc(server, "tasks/cancel", { taskId: call.result.taskId });
  assert.equal(cancelled.result?.status, "cancelled");
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  const later = await rpc(server, "tasks/get", { taskId: call.result.taskId });
  assert.equal(later.result?.status, "cancelled");
}));
test("completed tasks expire from the task store", async () => {
  const store = new TaskStore({ ttlMs: 10 });
  const task = store.create(async () => ({ resultType: "complete", content: [{ type: "text", text: "ok" }], isError: false }));
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(store.get(task.taskId), undefined);
});
