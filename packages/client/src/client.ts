import {
  CallToolResult, clientCapabilities, EXTENSION_ID, JsonValue, META_CLIENT_CAPABILITIES, PROTOCOL_VERSION,
  RequestMeta, ServerInfo, TASKS_EXTENSION_ID, VerifiableToolsCapability
} from "@demo/protocol";
import { DemoCommitVerifier, DemoSigVerifier, expectedInputCommitment, VerificationKeyRegistry } from "@demo/verifier";
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
    while (true) {
      const response = await this.request("tasks/get", { taskId: task.taskId, _meta: this.requestMeta(true) });
      if (response.error) throw new Error(response.error.message);
      const current = asRecord(response.result);
      if (current.status === "completed" && current.result) return current.result as unknown as CallToolResult;
      if (current.status !== "working") throw new Error(`task ${String(current.status)}`);
      await new Promise<void>((resolve) => setTimeout(resolve, Number(current.pollIntervalMs)));
    }
  }
  async blindCall(args: JsonValue, requestedProofFormat = "demo-sig-v1"): Promise<CallToolResult> {
    const discovery = this.discovered ?? await this.discover();
    const keyPair = await import("node:crypto").then(({ generateKeyPairSync }) => generateKeyPairSync("x25519"));
    const publicJwk = keyPair.publicKey.export({ type: "spki", format: "jwk" }) as { x?: string };
    const serverPublic = await import("node:crypto").then(({ createPublicKey }) => createPublicKey({ key: { kty: "OKP", crv: "X25519", x: Buffer.from(discovery.blindPublicKey, "base64").toString("base64url") }, format: "jwk" }));
    const shared = await import("node:crypto").then(({ diffieHellman }) => diffieHellman({ privateKey: keyPair.privateKey, publicKey: serverPublic }));
    const { createCipheriv, hkdfSync, randomBytes } = await import("node:crypto");
    const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from("x25519-aesgcm-demo-v1"), 32));
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(canonicalJson(args))), cipher.final()]);
    const envelope = {
      epk: Buffer.from(publicJwk.x ?? "", "base64url").toString("base64"),
      iv: iv.toString("base64"),
      ciphertext: encrypted.toString("base64"),
      tag: cipher.getAuthTag().toString("base64")
    };
    const commitment = expectedInputCommitment(args);
    const response = await this.request("verifiable-tools/call", {
      tool: "privateCreditCheck", inputCommitment: commitment, encryptionScheme: "x25519-aesgcm-demo-v1",
      encryptedArguments: Buffer.from(JSON.stringify(envelope)).toString("base64"), proofFormat: requestedProofFormat, _meta: this.requestMeta()
    });
    if (response.error) throw new Error(response.error.message);
    const result = response.result as unknown as CallToolResult;
    if (!await this.verify(result, args)) throw new Error("verification failed for blind call");
    return result;
  }
  private requestMeta(tasks = false): RequestMeta {
    if (tasks) {
      const extension = this.capabilities.extensions?.[EXTENSION_ID];
      this.capabilities.extensions = { ...this.capabilities.extensions, [TASKS_EXTENSION_ID]: {} };
      void extension;
    }
    return { "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION, [META_CLIENT_CAPABILITIES]: this.capabilities, "io.modelcontextprotocol/clientInfo": { name: "demo-client", version: "1.0.0" } };
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
function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
}
