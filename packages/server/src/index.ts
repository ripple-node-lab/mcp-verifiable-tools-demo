import { createServer, Server } from "node:http";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  CallToolResult, EXTENSION_ID, HPKE_INFO_ARGS, HPKE_INFO_REPLY, JsonRpcRequest, JsonRpcResponse,
  META_CLIENT_CAPABILITIES, META_SERVER_INFO, RequestMeta, RESULT_TTL_MS, b64u, hpkeOpen, hpkeSeal,
  inputCommitment, isRecord, isValidNonce, jcs, JsonValue, JsonRpcProtocolError, negotiateProofFormat, expectedCircuitHash,
  outputCommitment, parseAddArguments, rawX25519Public, tasksDeclared, verifiableCapability
} from "@demo/protocol";
import { DemoCommitProver, DemoSigProver, Prover, TeeNitroProver, TeeNitroProverOptions, mockNitroFixturesDir } from "@demo/prover";
import { prover as noirProver, artifacts as noirArtifacts, FORMAT as NOIR_FORMAT } from "@demo/prover-noir";
import { prover as snarkProver, artifacts as snarkArtifacts, FORMAT as SNARK_FORMAT } from "@demo/prover-snarkjs";
import { ToolFormatDescriptor } from "./tools.js";
import { discoverResponse } from "./discover.js";
import { errorResponse, handleMcpPost, paramsRecord } from "./http.js";
import { ResultStore } from "./prove.js";
import { TaskStore } from "./tasks.js";
import { circuitHash, executeTool, isZkFormat, makeResult, toolList, ToolName, DescriptorOverride } from "./tools.js";

export interface DemoServerOptions {
  port?: number;
  host?: string;
  resultTtlMs?: number;
  descriptorOverride?: DescriptorOverride;
  verificationKeyOverrides?: { [hash: string]: Uint8Array | string };
  provers?: Prover[];
  teeNitro?: false | TeeNitroProverOptions;
  formatDescriptors?: { [format: string]: ToolFormatDescriptor };
}
const toolNames: ToolName[] = ["add", "riskScore", "privateCreditCheck", "priceQuote"];

export class DemoServer {
  readonly httpServer: Server;
  readonly tasks: TaskStore;
  readonly results: ResultStore;
  private readonly signingProver = new DemoSigProver();
  private readonly blindKeys = generateKeyPairSync("x25519");
  private readonly signingPublicKey: string;
  private readonly blindPublicKey: string;
  private readonly host: string;
  private readonly descriptorOverride?: DescriptorOverride;
  private readonly verificationKeyOverrides: { [hash: string]: Uint8Array | string };
  private readonly formatDescriptors: { [format: string]: ToolFormatDescriptor };
  private readonly provers = new Map<string, Prover>();
  private port = 0;
  constructor(options: DemoServerOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.tasks = new TaskStore();
    this.results = new ResultStore(options.resultTtlMs ?? RESULT_TTL_MS);
    this.descriptorOverride = options.descriptorOverride;
    this.verificationKeyOverrides = options.verificationKeyOverrides ?? {};
    this.formatDescriptors = options.formatDescriptors ?? {};
    this.provers.set("demo-sig-v1", this.signingProver);
    this.provers.set("demo-commit-v1", new DemoCommitProver());
    this.provers.set(SNARK_FORMAT, snarkProver);
    this.provers.set(NOIR_FORMAT, noirProver);
    if (options.teeNitro !== false) {
      const userData = new Uint8Array(createHash("sha256").update(rawX25519Public(this.blindKeys.publicKey)).digest());
      const tee = options.teeNitro ? new TeeNitroProver({ userData, ...options.teeNitro }) : TeeNitroProver.fromMockFixtures(mockNitroFixturesDir(), { userData });
      this.provers.set(tee.format, tee);
    }
    for (const prover of options.provers ?? []) {
      if (this.provers.has(prover.format)) throw new Error(`duplicate prover format: ${prover.format}`);
      this.provers.set(prover.format, prover);
    }
    this.signingPublicKey = String(this.signingProver.publicKey.export({ type: "spki", format: "pem" }));
    this.blindPublicKey = b64u(rawX25519Public(this.blindKeys.publicKey));
    this.httpServer = createServer((request, response) => {
      if (request.url === "/mcp") void handleMcpPost(this, request, response);
      else if (request.method === "GET" && request.url?.startsWith("/vk/")) void this.serveVerificationKey(request.url.slice(4), response);
      else { response.statusCode = 404; response.end(); }
    });
  }
  async listen(port = 0): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { this.httpServer.removeListener("error", onError); reject(error); };
      this.httpServer.once("error", onError);
      this.httpServer.listen(port, this.host, () => { this.httpServer.removeListener("error", onError); resolve(); });
    });
    const address = this.httpServer.address();
    this.port = typeof address === "object" && address !== null ? address.port : port;
    return this.url;
  }
  async close(): Promise<void> {
    this.results.close();
    await new Promise<void>((resolve, reject) => this.httpServer.close((error) => error ? reject(error) : resolve()));
  }
  get url(): string { return `http://${this.host}:${this.port}`; }
  get mcpUrl(): string { return `${this.url}/mcp`; }
  get blindPublicKeyBase64(): string { return this.blindPublicKey; }
  get formats(): string[] { return [...this.provers.keys()]; }
  private toolFormats(tool: ToolName): string[] {
    return this.formats.filter((format) => !isZkFormat(format) || tool === "add");
  }
  private async serveVerificationKey(hash: string, response: import("node:http").ServerResponse): Promise<void> {
    try {
      const override = this.verificationKeyOverrides[hash];
      if (override !== undefined) {
        response.statusCode = 200; response.setHeader("content-type", "application/json");
        response.end(typeof override === "string" ? override : override);
        return;
      }
      if (hash === expectedCircuitHash("add", SNARK_FORMAT)) {
        response.statusCode = 200; response.setHeader("content-type", "application/json"); response.end(await readFile(snarkArtifacts.vk)); return;
      }
      if (hash === expectedCircuitHash("add", NOIR_FORMAT)) {
        response.statusCode = 200; response.setHeader("content-type", "application/json"); response.end(await readFile(noirArtifacts.vk)); return;
      }
      if (toolNames.map(circuitHash).includes(hash)) {
        response.statusCode = 200; response.setHeader("content-type", "application/x-pem-file"); response.end(this.signingPublicKey); return;
      }
      response.statusCode = 404; response.end();
    } catch { response.statusCode = 500; response.end(); }
  }
  async dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      if (request.method === "server/discover") return discoverResponse(request.id, this.formats, this.blindPublicKey, this.results.retentionMs);
      if (request.method === "tools/list") return { jsonrpc: "2.0", id: request.id, result: { resultType: "complete", tools: toolList(this.url, this.formats, this.formatDescriptors, this.descriptorOverride) } };
      if (request.method === "tools/call") return await this.callTool(request);
      if (request.method === "tasks/get") return this.getTask(request);
      if (request.method === "tasks/cancel") return this.cancelTask(request);
      if (request.method === "verifiable-tools/call") return await this.blindCall(request);
      if (request.method === "verifiable-tools/prove") return await this.prove(request);
      return errorResponse(request.id, -32601, "Method not found");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Internal error";
      const code = error instanceof JsonRpcProtocolError ? error.code : -32603;
      return errorResponse(request.id, code, message, error instanceof JsonRpcProtocolError ? error.data : undefined);
    }
  }
  private async callTool(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = paramsRecord(request.params);
    if (!params || typeof params.name !== "string" || params.arguments === undefined) throw new JsonRpcProtocolError(-32602, "invalid tool call parameters");
    const tool = params.name as ToolName;
    if (!toolNames.includes(tool)) throw new JsonRpcProtocolError(-32602, "invalid tool name");
    if (tool === "privateCreditCheck") throw new JsonRpcProtocolError(-32602, "privateCreditCheck requires verifiable-tools/call");
    const requestMeta = isRecord(params._meta) ? params._meta as unknown as RequestMeta : undefined;
    const extensionMeta = isRecord(requestMeta?.[EXTENSION_ID]) ? requestMeta[EXTENSION_ID] : undefined;
    const nonce = extensionMeta?.nonce;
    if (nonce !== undefined && !isValidNonce(nonce)) throw new JsonRpcProtocolError(-32602, "invalid nonce");
    const capability = verifiableCapability(requestMeta?.[META_CLIENT_CAPABILITIES]);
    const requested = typeof extensionMeta?.requestedProofFormat === "string" ? extensionMeta.requestedProofFormat : undefined;
    const toolFormats = this.toolFormats(tool);
    const format = negotiateProofFormat(capability, toolFormats, requested);
    if (capability?.requireProof && !format) throw new JsonRpcProtocolError(-32602, "no mutually supported proof format");
    if (tool === "add" && isZkFormat(format ?? "") && !parseAddArguments(params.arguments)) {
      throw new JsonRpcProtocolError(-32602, "invalid arguments for add");
    }
    const execute = async (signal?: AbortSignal): Promise<CallToolResult> => {
      const execution = executeTool(tool, params.arguments!, isZkFormat(format ?? ""));
      if (tool === "priceQuote" && capability && !capability.requireProof) {
        const content = [{ type: "text" as const, text: execution.output }];
        const resultId = this.results.put({ tool, arguments: execution.arguments, content, nonce });
        return makeResult(execution.output, { [META_SERVER_INFO]: { name: "verifiable-tools-demo", version: "1.0.0" }, [EXTENSION_ID]: { resultId } });
      }
      if (!format) return makeResult(execution.output);
      return this.provenResult(tool, execution.arguments, execution.output, format, nonce, undefined, signal);
    };
    if (tasksDeclared(requestMeta?.[META_CLIENT_CAPABILITIES]) && (tool === "riskScore" || isZkFormat(format ?? ""))) {
      return { jsonrpc: "2.0", id: request.id, result: this.tasks.create(async (signal) => {
        if (tool === "riskScore") await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 300);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); }, { once: true });
        });
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        return execute(signal);
      }) };
    }
    return { jsonrpc: "2.0", id: request.id, result: await execute() };
  }
  private async provenResult(tool: ToolName, args: JsonValue, output: string, format: string, nonce?: string, salt?: Uint8Array, signal?: AbortSignal, content?: CallToolResult["content"]): Promise<CallToolResult> {
    const originalContent = content ?? [{ type: "text" as const, text: output }];
    const input = inputCommitment(args, salt);
    const outputHash = outputCommitment(originalContent);
    const prover = this.provers.get(format);
    if (!prover) throw new JsonRpcProtocolError(-32602, "unsupported proof format");
    const formatHash = expectedCircuitHash(tool, format);
    const descriptor = this.formatDescriptors[format]?.(formatHash) ?? {};
    const effectiveHash = descriptor.circuitHash ?? formatHash;
    const verificationKeyUri = descriptor.verificationKeyUri ?? (format === "demo-sig-v1" || isZkFormat(format) ? `${this.url}/vk/${effectiveHash}` : undefined);
    const meta = await prover.prove({ arguments: args, circuitHash: effectiveHash, inputCommitment: input, outputCommitment: outputHash, nonce, output, verificationKeyUri }, { signal });
    return { resultType: "complete", content: originalContent, isError: false, _meta: { [META_SERVER_INFO]: { name: "verifiable-tools-demo", version: "1.0.0" }, [EXTENSION_ID]: meta as unknown as RequestMeta[typeof EXTENSION_ID] } };
  }
  private getTask(request: JsonRpcRequest): JsonRpcResponse {
    const params = paramsRecord(request.params);
    if (!params || typeof params.taskId !== "string") throw new JsonRpcProtocolError(-32602, "invalid task parameters");
    const task = this.tasks.get(params.taskId);
    if (!task) throw new JsonRpcProtocolError(-32602, "invalid taskId");
    return { jsonrpc: "2.0", id: request.id, result: { resultType: "complete", ...task } as unknown as JsonValue };
  }
  private cancelTask(request: JsonRpcRequest): JsonRpcResponse {
    const params = paramsRecord(request.params);
    if (!params || typeof params.taskId !== "string") throw new JsonRpcProtocolError(-32602, "invalid task parameters");
    const task = this.tasks.cancel(params.taskId);
    if (!task) throw new JsonRpcProtocolError(-32602, "invalid taskId");
    return { jsonrpc: "2.0", id: request.id, result: { resultType: "complete", ...task } as unknown as JsonValue };
  }
  private async blindCall(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = paramsRecord(request.params);
    if (!params || typeof params.tool !== "string" || typeof params.inputCommitment !== "string" || params.encryptionScheme !== "hpke-v1" || typeof params.encryptedArguments !== "string") throw new JsonRpcProtocolError(-32602, "invalid blind call parameters");
    if (params.encryptedArguments.length > 128 * 1024) throw new JsonRpcProtocolError(-32602, "invalid encrypted arguments");
    const requestMeta = isRecord(params._meta) ? params._meta as unknown as RequestMeta : undefined;
    const extensionMeta = isRecord(requestMeta?.[EXTENSION_ID]) ? requestMeta[EXTENSION_ID] : undefined;
    const nonce = extensionMeta?.nonce;
    if (nonce !== undefined && !isValidNonce(nonce)) throw new JsonRpcProtocolError(-32602, "invalid nonce");
    const capability = verifiableCapability(requestMeta?.[META_CLIENT_CAPABILITIES]);
    if (capability?.blindExecution !== true) throw new JsonRpcProtocolError(-32602, "client did not declare blindExecution");
    const toolFormats = this.toolFormats(params.tool as ToolName);
    const format = negotiateProofFormat(capability, toolFormats, typeof params.proofFormat === "string" ? params.proofFormat : undefined);
    if (!format) throw new JsonRpcProtocolError(-32602, "no mutually supported proof format");
    const raw = Buffer.from(params.encryptedArguments, "base64url");
    const aad = new TextEncoder().encode(jcs({ tool: params.tool, inputCommitment: params.inputCommitment, encryptionScheme: "hpke-v1" } as unknown as JsonValue));
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(hpkeOpen(this.blindKeys.privateKey, rawX25519Public(this.blindKeys.publicKey), new TextEncoder().encode(HPKE_INFO_ARGS), aad, new Uint8Array(raw))));
    } catch { throw new JsonRpcProtocolError(-32602, "invalid encrypted arguments"); }
    if (!isRecord(payload) || typeof payload.salt !== "string" || !/^0x[0-9a-f]{64}$/.test(payload.salt) || !isRecord(payload.arguments)) throw new JsonRpcProtocolError(-32602, "invalid encrypted arguments");
    const salt = new Uint8Array(Buffer.from(payload.salt.slice(2), "hex"));
    if (inputCommitment(payload.arguments, salt) !== params.inputCommitment) throw new JsonRpcProtocolError(-32602, "inputCommitment does not match encrypted arguments");
    if (params.tool !== "privateCreditCheck") throw new JsonRpcProtocolError(-32602, "invalid blind tool");
    const execution = executeTool("privateCreditCheck", payload.arguments);
    const result = await this.provenResult("privateCreditCheck", execution.arguments, execution.output, format, nonce, salt);
    if (typeof params.replyPublicKey === "string") {
      const replyKey = Buffer.from(params.replyPublicKey, "base64url");
      if (replyKey.length !== 32) throw new JsonRpcProtocolError(-32602, "invalid replyPublicKey");
      const originalContent = result.content;
      const replyAadObject = nonce === undefined ? { tool: params.tool, inputCommitment: params.inputCommitment } : { tool: params.tool, inputCommitment: params.inputCommitment, nonce };
      const ciphertext = hpkeSeal(new Uint8Array(replyKey), new TextEncoder().encode(HPKE_INFO_REPLY), new TextEncoder().encode(jcs(replyAadObject as unknown as JsonValue)), new TextEncoder().encode(jcs(originalContent as unknown as JsonValue)));
      result.content = [{ type: "text", text: b64u(ciphertext) }];
      result._meta = { ...result._meta, [EXTENSION_ID]: { ...(result._meta?.[EXTENSION_ID] ?? {}), encryptedContent: true } } as unknown as RequestMeta;
    }
    return { jsonrpc: "2.0", id: request.id, result };
  }
  private async prove(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = paramsRecord(request.params);
    if (!params || typeof params.resultId !== "string") throw new JsonRpcProtocolError(-32602, "invalid prove parameters");
    const requestMeta = isRecord(params._meta) ? params._meta as unknown as RequestMeta : undefined;
    const capability = verifiableCapability(requestMeta?.[META_CLIENT_CAPABILITIES]);
    // Principal and session binding are outside this demo's scope.
    const record = this.results.get(params.resultId);
    if (record === undefined) throw new JsonRpcProtocolError(-32602, "result not found", { reason: "resultNotFound" });
    if (record === "expired") throw new JsonRpcProtocolError(-32602, "result expired", { reason: "resultExpired" });
    const nonce = params.nonce === undefined ? record.nonce : params.nonce;
    if (nonce !== undefined && !isValidNonce(nonce)) throw new JsonRpcProtocolError(-32602, "invalid nonce");
    const requested = typeof params.proofFormat === "string" ? params.proofFormat : undefined;
    const toolFormats = this.toolFormats(record.tool as ToolName);
    const format = requestMeta?.[META_CLIENT_CAPABILITIES] !== undefined
      ? negotiateProofFormat(capability, toolFormats, requested)
      : requested ?? "demo-sig-v1";
    if (!format || !toolFormats.includes(format)) throw new JsonRpcProtocolError(-32602, "unsupported proof format");
    const output = record.content[0]?.text ?? "";
    const result = await this.provenResult(record.tool as ToolName, record.arguments, output, format, nonce, record.salt, undefined, record.content);
    return { jsonrpc: "2.0", id: request.id, result };
  }
}
export async function startServer(options: DemoServerOptions = {}): Promise<DemoServer> { const server = new DemoServer(options); await server.listen(options.port); return server; }
export { ResultStore } from "./prove.js";
export { TaskStore } from "./tasks.js";
