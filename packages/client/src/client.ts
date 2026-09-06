import {
  CallToolResult, ClientCapabilities, EXTENSION_ID, HPKE_INFO_REPLY, JsonValue, META_CLIENT_CAPABILITIES,
  PROTOCOL_VERSION, RequestMeta, SUPPORTED_PROOF_FORMATS, TASKS_EXTENSION_ID, ToolDescriptorMeta,
  VerifiableToolsCapability, b64u, clientCapabilities, expectedCircuitHash, freshNonce, hpkeOpen,
  isRecord, jcs, unb64u, verifiableCapability
} from "@demo/protocol";
import { DemoCommitVerifier, DemoSigVerifier, VerificationKeyRegistry, VerifyOutcome, verifyResult } from "@demo/verifier";
import { encryptArguments, generateReplyKeyPair } from "./blind.js";
import { pollTask, RpcRequest } from "./tasks.js";

export interface DiscoverResult { proofFormats: string[]; serverProofFormats: string[]; blindPublicKeys: { [scheme: string]: string }; blindEncryptionSchemes: string[]; blindExecution: boolean; resultTtlMs?: number; }
export interface CallResponse { result: CallToolResult | TaskEnvelope; nonce: string; }
export class VerifiableClient {
  private capabilities: ClientCapabilities = clientCapabilities(["demo-sig-v1", "demo-commit-v1"]);
  private readonly registry: VerificationKeyRegistry;
  private readonly sigVerifier: DemoSigVerifier;
  private readonly commitVerifier = new DemoCommitVerifier();
  private discovered: DiscoverResult | undefined;
  private descriptors = new Map<string, ToolDescriptorMeta>();
  constructor(private readonly endpoint: string) { this.registry = new VerificationKeyRegistry([new URL(endpoint).origin]); this.sigVerifier = new DemoSigVerifier(this.registry); }
  async discover(): Promise<DiscoverResult> {
    this.descriptors.clear();
    const response = await this.request("server/discover", {});
    const result = asRecord(response.result);
    const extension = asRecord(asRecord(asRecord(result.capabilities).extensions)[EXTENSION_ID]);
    const formats = asStringArray(extension.proofFormats);
    const blindEncryptionSchemes = extension.blindEncryptionSchemes ? asStringArray(extension.blindEncryptionSchemes) : [];
    const blindPublicKeys = extension.blindPublicKeys && isRecord(extension.blindPublicKeys) ? extension.blindPublicKeys as { [scheme: string]: string } : {};
    const blindExecution = extension.blindExecution === true;
    const resultTtlMs = typeof extension.resultTtlMs === "number" ? extension.resultTtlMs : undefined;
    const proofFormats = formats.filter((format) => (SUPPORTED_PROOF_FORMATS as readonly string[]).includes(format));
    if (proofFormats.length === 0) throw new Error("no mutually supported proof format");
    const tools = asRecord((await this.request("tools/list", {})).result).tools;
    if (!Array.isArray(tools)) throw new Error("malformed tools/list response");
    for (const item of tools) {
      const tool = asRecord(item);
      const name = asString(tool.name);
      const extensionMeta = isRecord(tool._meta) ? tool._meta[EXTENSION_ID] : undefined;
      if (!isRecord(extensionMeta)) continue;
      const descriptor = extensionMeta as unknown as ToolDescriptorMeta;
      const expected = expectedCircuitHash(name);
      const formats = isRecord(descriptor.formats) ? Object.entries(descriptor.formats) : [];
      if (descriptor.circuitHash !== expected || formats.some(([format, value]) => isRecord(value) && typeof value.circuitHash === "string" && value.circuitHash !== expectedCircuitHash(name, format))) throw new Error(`tool descriptor circuitHash mismatch for ${name}`);
      this.descriptors.set(name, descriptor);
    }
    this.discovered = { proofFormats, serverProofFormats: formats, blindPublicKeys, blindEncryptionSchemes, blindExecution, resultTtlMs };
    return this.discovered;
  }
  descriptor(tool: string): ToolDescriptorMeta | undefined { return this.descriptors.get(tool); }
  setCapabilities(capability: VerifiableToolsCapability, tasks = false): void { this.capabilities = clientCapabilities(capability.proofFormats ?? [], { blindExecution: capability.blindExecution, requireProof: capability.requireProof, tasks }); }
  async callTool(name: string, args: JsonValue, options: { proofFormat?: string; nonce?: string } = {}): Promise<CallResponse> {
    const nonce = options.nonce ?? freshNonce();
    const meta = this.requestMeta();
    meta[EXTENSION_ID] = { ...(options.proofFormat ? { requestedProofFormat: options.proofFormat } : {}), nonce };
    const response = await this.request("tools/call", { name, arguments: args, _meta: meta });
    if (response.error) throw new Error(response.error.message);
    return { result: response.result as CallToolResult | TaskEnvelope, nonce };
  }
  async verify(result: CallToolResult, args: JsonValue, tool: string, options: { nonce?: string; salt?: Uint8Array } = {}): Promise<VerifyOutcome> {
    const meta = result._meta?.[EXTENSION_ID];
    const formats = verifiableCapability(this.capabilities)?.proofFormats ?? [];
    const verifiers = [...(formats.includes("demo-sig-v1") ? [this.sigVerifier] : []), ...(formats.includes("demo-commit-v1") ? [this.commitVerifier] : [])];
    const descriptor = this.descriptors.get(tool);
    const format = meta?.proofFormat;
    const verificationKeyUri = format === undefined || descriptor === undefined
      ? undefined
      : descriptor.formats?.[format]?.verificationKeyUri ?? descriptor.verificationKeyUri;
    return verifyResult(meta, { arguments: args, content: result.content, nonce: options.nonce, salt: options.salt, expectedCircuitHash: expectedCircuitHash(tool, format), verificationKeyUri }, verifiers);
  }
  async callAndVerify(name: string, args: JsonValue, proofFormat?: string): Promise<CallToolResult> {
    const value = await this.callTool(name, args, { proofFormat });
    const result = isTask(value.result) ? await this.poll(value.result) : value.result;
    const outcome = await this.verify(result, args, name, { nonce: value.nonce });
    if (!outcome.ok) throw new Error(`verification failed for ${name}: ${outcome.reason}`);
    return result;
  }
  async poll(task: TaskEnvelope): Promise<CallToolResult> { return pollTask(this.request.bind(this) as RpcRequest, task, this.requestMeta(true)); }
  async blindCall(args: JsonValue, options: { proofFormat?: string; encryptReply?: boolean } = {}): Promise<CallToolResult> {
    const discovery = this.discovered ?? await this.discover();
    if (!discovery.blindExecution || !discovery.blindPublicKeys["hpke-v1"]) throw new Error("server does not support blind execution");
    const encrypted = encryptArguments(args, discovery.blindPublicKeys["hpke-v1"], "privateCreditCheck");
    const nonce = freshNonce();
    const reply = options.encryptReply ? generateReplyKeyPair() : undefined;
    const response = await this.request("verifiable-tools/call", { tool: "privateCreditCheck", inputCommitment: encrypted.inputCommitment, encryptionScheme: "hpke-v1", encryptedArguments: encrypted.encryptedArguments, proofFormat: options.proofFormat ?? "demo-sig-v1", ...(reply ? { replyPublicKey: b64u(reply.publicKey) } : {}), _meta: { ...this.requestMeta(), [EXTENSION_ID]: { nonce } } });
    if (response.error) throw new Error(response.error.message);
    const result = response.result as CallToolResult;
    if (reply && result._meta?.[EXTENSION_ID]?.encryptedContent) {
      const plaintext = hpkeOpen(reply.privateKey, reply.publicKey, new TextEncoder().encode(HPKE_INFO_REPLY), new TextEncoder().encode(jcs({ tool: "privateCreditCheck", inputCommitment: encrypted.inputCommitment, nonce } as JsonValue)), unb64u(result.content[0].text));
      result.content = JSON.parse(new TextDecoder().decode(plaintext)) as CallToolResult["content"];
    }
    const outcome = await this.verify(result, args, "privateCreditCheck", { nonce, salt: encrypted.salt });
    if (!outcome.ok) throw new Error(`verification failed for blind call: ${outcome.reason}`);
    return result;
  }
  async prove(resultId: string, options: { proofFormat?: string; nonce?: string } = {}): Promise<CallResponse> {
    const nonce = options.nonce ?? freshNonce();
    const response = await this.request("verifiable-tools/prove", { resultId, ...(options.proofFormat ? { proofFormat: options.proofFormat } : {}), nonce, _meta: this.requestMeta() });
    if (response.error) throw new Error(response.error.message);
    return { result: response.result as CallToolResult, nonce };
  }
  private requestMeta(tasks = false): RequestMeta {
    const capabilities = tasks ? { ...this.capabilities, extensions: { ...this.capabilities.extensions, [TASKS_EXTENSION_ID]: {} } } : this.capabilities;
    return { "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION, [META_CLIENT_CAPABILITIES]: capabilities, "io.modelcontextprotocol/clientInfo": { name: "demo-client", version: "1.0.0" } };
  }
  private async request(method: string, params: unknown): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
    const headers: Record<string, string> = { "content-type": "application/json", "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": method };
    if (method === "tools/call") headers["Mcp-Name"] = String(asRecord(params).name);
    const response = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
    return await response.json() as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
  }
}
export interface TaskEnvelope { resultType: "task"; taskId: string; status: string; pollIntervalMs: number; ttlMs?: number; }
function isTask(value: unknown): value is TaskEnvelope { return isRecord(value) && value.resultType === "task" && typeof value.taskId === "string"; }
function asRecord(value: unknown): { [key: string]: JsonValue } { if (!isRecord(value)) throw new Error("malformed JSON response"); return value; }
function asString(value: JsonValue | undefined): string { if (typeof value !== "string") throw new Error("malformed discovery response"); return value; }
function asStringArray(value: JsonValue | undefined): string[] { if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("malformed discovery response"); return value; }
