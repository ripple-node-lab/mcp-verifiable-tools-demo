import { randomUUID } from "node:crypto";
import { CallToolResult, Task, TaskResult, TaskStatus } from "@demo/protocol";
export interface TaskStoreOptions { ttlMs?: number; }
export class TaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly ttlMs: number;
  constructor(options: TaskStoreOptions = {}) { this.ttlMs = options.ttlMs ?? 60000; }
  create(produce: (signal: AbortSignal) => Promise<CallToolResult>): TaskResult {
    this.sweep();
    const taskId = `task-${randomUUID()}`;
    const now = new Date().toISOString();
    const task: Task = { taskId, status: "working", createdAt: now, lastUpdatedAt: now, ttlMs: this.ttlMs, pollIntervalMs: 100 };
    this.tasks.set(taskId, task);
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return produce(controller.signal); })
      .then((result) => this.update(taskId, "completed", result))
      .catch((error: unknown) => this.fail(taskId, error))
      .finally(() => this.controllers.delete(taskId));
    return { resultType: "task", ...task };
  }
  get(taskId: string): Task | undefined { this.sweep(); return this.tasks.get(taskId); }
  cancel(taskId: string): Task | undefined {
    this.sweep();
    const task = this.tasks.get(taskId);
    if (task && task.status === "working") {
      this.controllers.get(taskId)?.abort();
      this.update(taskId, "cancelled");
    }
    return task;
  }
  private sweep(): void {
    const now = Date.now();
    for (const [taskId, task] of this.tasks) {
      if (Date.parse(task.lastUpdatedAt) + task.ttlMs >= now) continue;
      if (task.status === "working") {
        this.controllers.get(taskId)?.abort();
        this.controllers.delete(taskId);
        task.status = "failed";
        task.lastUpdatedAt = new Date(now).toISOString();
      } else {
        this.tasks.delete(taskId);
      }
    }
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
    const existing = this.tasks.get(taskId);
    if (existing?.status === "cancelled" && error instanceof DOMException && error.name === "AbortError") return;
    this.update(taskId, "failed", undefined);
    const task = this.tasks.get(taskId);
    if (task) task.error = { code: -32603, message: detail };
  }
}
