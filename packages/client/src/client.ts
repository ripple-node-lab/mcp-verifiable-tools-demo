import {
  CallToolResult, clientCapabilities, EXTENSION_ID, JsonValue, META_CLIENT_CAPABILITIES, PROTOCOL_VERSION,
  RequestMeta, ServerInfo, TASKS_EXTENSION_ID, VerifiableToolsCapability, verifiableCapability
} from "@demo/protocol";
import { DemoCommitVerifier, DemoSigVerifier, VerificationKeyRegistry } from "@demo/verifier";
import { encryptArguments } from "./blind.js";
import { pollTask, RpcRequest } from "./tasks.js";
export interface DiscoverResult { proofFormats: string[]; blindPublicKey: string; }
export class VerifiableClient {
  private capabilities = clientCapabilities(["demo-sig-v1", "demo-commit-v1"]);
  private readonly registry = new VerificationKeyRegistry();
  private readonly sigVerifier = new DemoSigVerifier(this.registry);
  private readonly commitVerifier = new DemoCommitVerifier();
  private serverInfo: ServerInfo | undefined;
  private discovered: DiscoverResult | undefined;
  constructor(private readonly endpoint: string) {}
  async discover(): Promise<DiscoverResult> {
    const response = await this.request("server/discover", {});
    const result = asRecord(response.result);
    const capabilities = asRecord(result.capabilities);
    const extensions = asRecord(capabilities.extensions);
    const extension = asRecord(extensions[EXTENSION_ID]);
    const formats = asStringArray(extension.proofFormats);
    const blindPublicKey = asString(extension.blindPublicKey);
    this.serverInfo = asRecord(result._meta)?.["io.modelcontextprotocol/serverInfo"] as unknown as ServerInfo | undefined;
    this.discovered = { proofFormats: formats, blindPublicKey };
    return this.discovered;
  }
  setCapabilities(capability: VerifiableToolsCapability, tasks = false): void {
    this.capabilities = clientCapabilities(capability.proofFormats ?? [], { blindExecution: capability.blindExecution, requireProof: capability.requireProof, tasks });
  }
  async callTool(name: string, args: JsonValue, requestedProofFormat?: string): Promise<CallToolResult | TaskEnvelope> {
    const meta: RequestMeta = this.requestMeta();
    if (requestedProofFormat) meta[EXTENSION_ID] = { requestedProofFormat };
    const response = await this.request("tools/call", { name, arguments: args, _meta: meta });
    if (response.error) throw new Error(response.error.message);
    const result = response.result;
    if (isTask(result)) return result;
    return result as unknown as CallToolResult;
  }
  async verify(result: CallToolResult, args: JsonValue): Promise<boolean> {
    const meta = result._meta?.[EXTENSION_ID];
    if (!meta) return false;
    if (!verifiableCapability(this.capabilities)?.proofFormats?.includes(meta.proofFormat ?? "")) return false;
    const context = { arguments: args, output: result.content[0].text };
    if (meta.proofFormat === "demo-sig-v1") return this.sigVerifier.verify(meta, context);
    if (meta.proofFormat === "demo-commit-v1") return this.commitVerifier.verify(meta, context);
    return false;
  }
  async callAndVerify(name: string, args: JsonValue, requestedProofFormat?: string): Promise<CallToolResult> {
    const value = await this.callTool(name, args, requestedProofFormat);
    const result = isTask(value) ? await this.poll(value) : value;
    if (!await this.verify(result, args)) throw new Error(`verification failed for ${name}`);
    return result;
  }
  async poll(task: TaskEnvelope): Promise<CallToolResult> {
    return pollTask(this.request.bind(this) as RpcRequest, task, this.requestMeta(true));
  }
  async blindCall(args: JsonValue, requestedProofFormat = "demo-sig-v1"): Promise<CallToolResult> {
    const discovery = this.discovered ?? await this.discover();
    const encrypted = encryptArguments(args, discovery.blindPublicKey);
    const response = await this.request("verifiable-tools/call", {
      tool: "privateCreditCheck", inputCommitment: encrypted.inputCommitment, encryptionScheme: "x25519-aesgcm-demo-v1",
      encryptedArguments: encrypted.encryptedArguments, proofFormat: requestedProofFormat, _meta: this.requestMeta()
    });
    if (response.error) throw new Error(response.error.message);
    const result = response.result as unknown as CallToolResult;
    if (!await this.verify(result, args)) throw new Error("verification failed for blind call");
    return result;
  }
  private requestMeta(tasks = false): RequestMeta {
    const capabilities = tasks ? { ...this.capabilities, extensions: { ...this.capabilities.extensions, [TASKS_EXTENSION_ID]: {} } } : this.capabilities;
    return { "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION, [META_CLIENT_CAPABILITIES]: capabilities, "io.modelcontextprotocol/clientInfo": { name: "demo-client", version: "1.0.0" } };
  }
  private async request(method: string, params: unknown): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
    const headers: Record<string, string> = { "content-type": "application/json", "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": method };
    if (method === "tools/call") headers["Mcp-Name"] = String(asRecord(params).name);
    const response = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
    return await response.json() as { result?: unknown; error?: { code: number; message: string } };
  }
}
export interface TaskEnvelope { resultType: "task"; taskId: string; status: string; pollIntervalMs: number; }
function isTask(value: unknown): value is TaskEnvelope { return isRecord(value) && value.resultType === "task" && typeof value.taskId === "string"; }
function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asRecord(value: unknown): { [key: string]: JsonValue } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("malformed JSON response");
  return value as { [key: string]: JsonValue };
}
function asString(value: JsonValue | undefined): string { if (typeof value !== "string") throw new Error("malformed discovery response"); return value; }
function asStringArray(value: JsonValue | undefined): string[] { if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("malformed discovery response"); return value; }
