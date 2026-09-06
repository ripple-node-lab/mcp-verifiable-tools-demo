import { Worker } from "node:worker_threads";
import { VerifiableToolsMeta, parseAddArguments } from "@demo/protocol";
import { Prover, ProveInput } from "@demo/prover";
import { FORMAT, circuitHash } from "./runtime.js";
import { artifacts } from "./artifacts.js";

export { FORMAT, circuitHash, getApi, destroy } from "./runtime.js";
export { artifacts } from "./artifacts.js";
export class NoirProver implements Prover {
  readonly format = FORMAT;
  async prove(input: ProveInput, options: { signal?: AbortSignal } = {}): Promise<VerifiableToolsMeta> {
    const args = parseAddArguments(input.arguments);
    if (!args) throw new Error("arguments out of circuit range");
    return await proveInWorker(input, options.signal);
  }
}
interface WorkerRequest {
  id: number;
  input: ProveInput;
  signal?: AbortSignal;
  resolve: (meta: VerifiableToolsMeta) => void;
  reject: (error: unknown) => void;
  abort: () => void;
}
let worker: Worker | undefined;
let active: WorkerRequest | undefined;
let nextRequestId = 1;
const queued: WorkerRequest[] = [];

function startWorker(): Worker {
  const instance = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  instance.unref();
  instance.on("message", (message: { id: number; ok: boolean; meta?: VerifiableToolsMeta; error?: { message: string } }) => {
    if (!active || message.id !== active.id) return;
    const request = active;
    active = undefined;
    request.signal?.removeEventListener("abort", request.abort);
    if (message.ok && message.meta) request.resolve(message.meta);
    else request.reject(new Error(message.error?.message ?? "prover worker failed"));
    pumpWorker();
  });
  instance.on("error", (error: Error) => {
    if (worker !== instance) return;
    worker = undefined;
    const request = active;
    active = undefined;
    request?.signal?.removeEventListener("abort", request.abort);
    request?.reject(error);
    pumpWorker();
  });
  instance.on("exit", (code: number) => {
    if (worker !== instance || code === 0) return;
    worker = undefined;
    const request = active;
    active = undefined;
    request?.signal?.removeEventListener("abort", request.abort);
    request?.reject(new Error(`prover worker exited with code ${code}`));
    pumpWorker();
  });
  return instance;
}

function pumpWorker(): void {
  if (active || queued.length === 0) return;
  worker ??= startWorker();
  active = queued.shift();
  try { worker.postMessage({ id: active!.id, input: active!.input }); }
  catch (error) {
    const request = active;
    active = undefined;
    request?.signal?.removeEventListener("abort", request.abort);
    request?.reject(error instanceof Error ? error : new Error("prover worker failed"));
    pumpWorker();
  }
}

function proveInWorker(input: ProveInput, signal?: AbortSignal): Promise<VerifiableToolsMeta> {
  if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  return new Promise<VerifiableToolsMeta>((resolve, reject) => {
    const request = {} as WorkerRequest;
    request.id = nextRequestId++;
    request.input = input;
    request.signal = signal;
    request.resolve = resolve;
    request.reject = reject;
    request.abort = (): void => {
      const queuedIndex = queued.indexOf(request);
      if (queuedIndex >= 0) {
        queued.splice(queuedIndex, 1);
        signal?.removeEventListener("abort", request.abort);
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      if (active !== request) return;
      active = undefined;
      signal?.removeEventListener("abort", request.abort);
      reject(new DOMException("aborted", "AbortError"));
      const oldWorker = worker;
      worker = undefined;
      void oldWorker?.terminate().finally(() => pumpWorker());
    };
    signal?.addEventListener("abort", request.abort, { once: true });
    queued.push(request);
    pumpWorker();
  });
}

export function closeProverWorker(): void {
  const error = new Error("prover worker closed");
  const requests = active ? [active, ...queued] : [...queued];
  active = undefined;
  queued.length = 0;
  for (const request of requests) {
    request.signal?.removeEventListener("abort", request.abort);
    request.reject(error);
  }
  const oldWorker = worker;
  worker = undefined;
  void oldWorker?.terminate();
}

export const prover: Prover = new NoirProver();
export { NoirVerifier, verifier, verifyNoir } from "./verifier.js";
