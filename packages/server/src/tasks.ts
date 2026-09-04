import { CallToolResult, JsonRpcError, Task, TaskResult, TaskStatus } from "@demo/protocol";
export class TaskStore {
  private readonly tasks = new Map<string, Task>();
  create(produce: () => Promise<CallToolResult>): TaskResult {
    const taskId = `task-${randomUUID()}`;
    const now = new Date().toISOString();
    const task: Task = { taskId, status: "working", createdAt: now, lastUpdatedAt: now, ttlMs: 60000, pollIntervalMs: 100 };
    this.tasks.set(taskId, task);
    void produce().then((result) => this.update(taskId, "completed", result)).catch((error: unknown) => this.fail(taskId, error));
    return { resultType: "task", ...task };
  }
  get(taskId: string): Task | undefined { return this.tasks.get(taskId); }
  cancel(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (task && task.status === "working") this.update(taskId, "cancelled");
    return task;
  }
  private update(taskId: string, status: TaskStatus, result?: CallToolResult): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "working") return;
    task.status = status;
    task.lastUpdatedAt = new Date().toISOString();
    if (result) task.result = result;
  }
  private fail(taskId: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : "task failed";
    this.update(taskId, "failed", undefined);
    const task = this.tasks.get(taskId);
    if (task) task.error = { code: -32603, message: detail };
  }
}
import { randomUUID } from "node:crypto";
