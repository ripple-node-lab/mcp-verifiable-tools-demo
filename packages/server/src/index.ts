import { createServer, Server } from "node:http";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  CallToolResult, clientCapabilities, EXTENSION_ID, JsonRpcRequest, JsonRpcResponse, META_CLIENT_CAPABILITIES,
  META_SERVER_INFO, PROTOCOL_VERSION, RequestMeta, TASKS_EXTENSION_ID, tasksDeclared, verifiableCapability,
  negotiateProofFormat, isRecord, JsonValue, VerifiableToolsMeta, VerifiableCallParams
} from "@demo/protocol";
import { DemoCommitProver, DemoSigProver, Prover } from "@demo/prover";
import { discoverResponse } from "./discover.js";
import { handleMcpPost, errorResponse, paramsRecord, send } from "./http.js";
import { TaskStore } from "./tasks.js";
import { circuitHash, executeTool, inputCommitment, makeResult, proverFor, toolList, ToolName } from "./tools.js";
import { blindResult, decryptArguments } from "./blind.js";
export interface DemoServerOptions { port?: number; host?: string; }
export class DemoServer {
  readonly httpServer: Server;
  readonly tasks = new TaskStore();
  private readonly signingProver = new DemoSigProver();
  private readonly blindKeys = generateKeyPairSync("x25519");
  private readonly signingPublicKey: string;
  private readonly blindPublicKey: string;
  private port = 0;
  private readonly host: string;
  constructor(options: DemoServerOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.signingPublicKey = String(this.signingProver.publicKey.export({ type: "spki", format: "pem" }));
    const jwk = this.blindKeys.publicKey.export({ type: "spki", format: "jwk" }) as { x?: string };
    this.blindPublicKey = Buffer.from(jwk.x ?? "", "base64url").toString("base64");
    this.httpServer = createServer((request, response) => {
      if (request.url === "/mcp") void handleMcpPost(this, request, response);
      else if (request.method === "GET" && request.url?.startsWith("/vk/")) {
        response.statusCode = 200;
        response.setHeader("content-type", "application/x-pem-file");
        response.end(this.signingPublicKey);
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
  }
  async listen(port = 0): Promise<string> {
    await new Promise<void>((resolve) => this.httpServer.listen(port, this.host, () => resolve()));
    const address = this.httpServer.address();
    this.port = typeof address === "object" && address !== null ? address.port : port;
    return this.url;
  }
  async close(): Promise<void> { await new Promise<void>((resolve, reject) => this.httpServer.close((error) => error ? reject(error) : resolve())); }
  get url(): string { return `http://${this.host}:${this.port}`; }
  get mcpUrl(): string { return `${this.url}/mcp`; }
  get blindPublicKeyBase64(): string { return this.blindPublicKey; }
  async dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      if (request.method === "server/discover") return discoverResponse(request.id, this.blindPublicKey);
      if (request.method === "tools/list") return { jsonrpc: "2.0", id: request.id, result: { resultType: "complete", tools: toolList() } };
      if (request.method === "tools/call") return await this.callTool(request);
      if (request.method === "tasks/get") return this.getTask(request);
      if (request.method === "tasks/cancel") return this.cancelTask(request);
      if (request.method === "verifiable-tools/call") return this.blindCall(request);
      return errorResponse(request.id, -32601, "Method not found");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Internal error";
      const code = message.startsWith("invalid") || message.includes("requires") || message.includes("does not match") || message.includes("unsupported") || message.includes("no mutually") ? -32602 : -32603;
      return errorResponse(request.id, code, message);
    }
  }
  private async callTool(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = paramsRecord(request.params);
    if (!params || typeof params.name !== "string" || !params.arguments) throw new Error("invalid tool call parameters");
    const tool = params.name as ToolName;
    if (!["add", "riskScore", "privateCreditCheck"].includes(tool)) throw new Error("invalid tool name");
    if (tool === "privateCreditCheck") throw new Error("privateCreditCheck requires verifiable-tools/call");
    const meta = params._meta;
    const requestMeta = isRecord(meta) ? meta as unknown as RequestMeta : undefined;
    const capability = verifiableCapability(requestMeta?.[META_CLIENT_CAPABILITIES]);
    const requested = isRecord(requestMeta?.[EXTENSION_ID]) && typeof requestMeta?.[EXTENSION_ID].requestedProofFormat === "string" ? requestMeta[EXTENSION_ID].requestedProofFormat : undefined;
    const format = negotiateProofFormat(capability, ["demo-sig-v1", "demo-commit-v1"], requested);
    if (capability?.requireProof && !format) throw new Error("no mutually supported proof format");
    const execute = async (): Promise<CallToolResult> => {
      const execution = executeTool(tool, params.arguments!);
      if (!format) return makeResult(execution.output);
      return this.provenResult(tool, execution.arguments, execution.output, format);
    };
    if (tool === "riskScore" && tasksDeclared(requestMeta?.[META_CLIENT_CAPABILITIES])) {
      return { jsonrpc: "2.0", id: request.id, result: this.tasks.create(async () => new Promise<CallToolResult>((resolve) => setTimeout(() => void execute().then(resolve), 300))) };
    }
    return { jsonrpc: "2.0", id: request.id, result: await execute() };
  }
  private provenResult(tool: ToolName, args: JsonValue, output: string, format: string): CallToolResult {
    const commitment = inputCommitment(args);
    const prover: Prover = format === "demo-sig-v1" ? this.signingProver : new DemoCommitProver();
    const meta = prover.prove({ circuitHash: circuitHash(tool), inputCommitment: commitment, output });
    if (format === "demo-sig-v1") meta.verificationKeyUri = `${this.url}/vk/${meta.circuitHash}`;
    return makeResult(output, { [META_SERVER_INFO]: { name: "verifiable-tools-demo", version: "1.0.0" } as unknown as JsonValue, [EXTENSION_ID]: meta as unknown as JsonValue });
  }
  private getTask(request: JsonRpcRequest): JsonRpcResponse {
    const params = paramsRecord(request.params);
    if (!params || typeof params.taskId !== "string") throw new Error("invalid task parameters");
    const task = this.tasks.get(params.taskId);
    if (!task) throw new Error("invalid taskId");
    return { jsonrpc: "2.0", id: request.id, result: { resultType: "complete", ...task } as unknown as JsonValue };
  }
  private cancelTask(request: JsonRpcRequest): JsonRpcResponse {
    const params = paramsRecord(request.params);
    if (!params || typeof params.taskId !== "string") throw new Error("invalid task parameters");
    const task = this.tasks.cancel(params.taskId);
    if (!task) throw new Error("invalid taskId");
    return { jsonrpc: "2.0", id: request.id, result: { resultType: "complete", ...task } as unknown as JsonValue };
  }
  private blindCall(request: JsonRpcRequest): JsonRpcResponse {
    const params = paramsRecord(request.params);
    if (!params || typeof params.tool !== "string" || typeof params.inputCommitment !== "string" || typeof params.encryptionScheme !== "string" || typeof params.encryptedArguments !== "string") throw new Error("invalid blind call parameters");
    if (params.encryptionScheme !== "x25519-aesgcm-demo-v1") throw new Error("unsupported encryption scheme");
    const meta = isRecord(params._meta) ? params._meta as unknown as RequestMeta : undefined;
    const capability = verifiableCapability(meta?.[META_CLIENT_CAPABILITIES]);
    const requested = typeof params.proofFormat === "string" ? params.proofFormat : undefined;
    const format = negotiateProofFormat(capability, ["demo-sig-v1", "demo-commit-v1"], requested);
    if (!format) throw new Error("no mutually supported proof format");
    const args = decryptArguments(params.encryptedArguments, this.blindKeys);
    if (inputCommitment(args) !== params.inputCommitment) throw new Error("inputCommitment does not match encrypted arguments");
    const tool = params.tool as ToolName;
    if (tool !== "privateCreditCheck") throw new Error("invalid blind tool");
    const execution = executeTool(tool, args);
    return { jsonrpc: "2.0", id: request.id, result: this.provenResult(tool, execution.arguments, execution.output, format) };
  }
}
export async function startServer(options: DemoServerOptions = {}): Promise<DemoServer> {
  const server = new DemoServer(options);
  await server.listen(options.port);
  return server;
}
