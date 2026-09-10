import { createHash } from "node:crypto";
import {
  CallToolResult, ClientCapabilities, EXTENSION_ID, HPKE_INFO_REPLY, JsonValue, META_CLIENT_CAPABILITIES,
  PINNED_CIRCUITS, PROTOCOL_VERSION, RequestMeta, TASKS_EXTENSION_ID, ToolDescriptorMeta,
  VerifiableToolsCapability, b64u, clientCapabilities, expectedCircuitHash, freshNonce, hpkeOpen,
  isRecord, jcs, unb64u, verifiableCapability
} from "@demo/protocol";
import { mockNitroFixturesDir } from "@demo/prover";
import { DemoCommitVerifier, DemoSigVerifier, OracleSigVerifier, ProvenanceVerifier, TeeNitroVerifier, TeeNitroVerifierOptions, VerificationKeyRegistry, Verifier, VerifyOutcome, verifyResult } from "@demo/verifier";
import { NoirVerifier } from "@demo/prover-noir";
import { Risc0Verifier } from "@demo/prover-risc0";
import { EzklVerifier } from "@demo/prover-ezkl";
import { SnarkjsVerifier } from "@demo/prover-snarkjs";
import { encryptArguments, generateReplyKeyPair } from "./blind.js";
import { pollTask, RpcRequest } from "./tasks.js";

export interface DiscoverResult { proofFormats: string[]; serverProofFormats: string[]; blindPublicKeys: { [scheme: string]: string }; blindEncryptionSchemes: string[]; blindExecution: boolean; resultTtlMs?: number; }
export interface CallResponse { result: CallToolResult | TaskEnvelope; nonce: string; }
export type RpcTransport = (method: string, params: unknown) => Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }>;
export interface VerifiableClientOptions {
  verifiers?: Verifier[];
  provenanceVerifiers?: ProvenanceVerifier[];
  allowedKeyOrigins?: string[];
  teeNitro?: TeeNitroVerifierOptions | false;
  // Optional JSON-RPC transport override (e.g. the MCP SDK adapter). When set,
  // `endpoint` is only used as the verification-key registry origin.
  rpc?: RpcTransport;
  // Raw-HTTP fetch timeout per request (matches the sdkRpc default).
  timeoutMs?: number;
  // Optional caller-supplied abort signal combined with the request timeout.
  signal?: AbortSignal;
}
export class VerifiableClient {
  private capabilities: ClientCapabilities;
  private readonly registry: VerificationKeyRegistry;
  private readonly sigVerifier: DemoSigVerifier;
  private readonly commitVerifier = new DemoCommitVerifier();
  private readonly snarkjsVerifier = new SnarkjsVerifier();
  private readonly noirVerifier = new NoirVerifier();
  private readonly risc0Verifier = new Risc0Verifier();
  private readonly ezklVerifier = new EzklVerifier();
  private readonly extraVerifiers: Verifier[];
  private readonly provenanceVerifiers: ProvenanceVerifier[];
  private readonly teeNitroOption: TeeNitroVerifierOptions | false | undefined;
  private teeVerifier: TeeNitroVerifier | undefined;
  private discovered: DiscoverResult | undefined;
  private descriptors = new Map<string, ToolDescriptorMeta>();
  private readonly rpc?: RpcTransport;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;
  constructor(private readonly endpoint: string, options: VerifiableClientOptions = {}) {
    this.rpc = options.rpc;
    this.timeoutMs = options.timeoutMs ?? 200_000;
    this.signal = options.signal;
    this.registry = new VerificationKeyRegistry([new URL(endpoint).origin, ...(options.allowedKeyOrigins ?? [])]);
    this.sigVerifier = new DemoSigVerifier(this.registry);
    this.extraVerifiers = options.verifiers ?? [];
    this.provenanceVerifiers = options.provenanceVerifiers ?? [new OracleSigVerifier()];
    this.teeNitroOption = options.teeNitro;
    const formats = ["snarkjs-v2", "noir-v1", "risc0-v1", "ezkl-v1", "demo-sig-v1", "demo-commit-v1", ...(this.teeNitroOption === false ? [] : ["tee-nitro-v1"]), ...this.extraVerifiers.map((verifier) => verifier.format)];
    this.capabilities = clientCapabilities([...new Set(formats)]);
  }
  async discover(): Promise<DiscoverResult> {
    const response = await this.request("server/discover", {});
    const result = asRecord(response.result);
    const extension = asRecord(asRecord(asRecord(result.capabilities).extensions)[EXTENSION_ID]);
    const formats = asStringArray(extension.proofFormats);
    const blindEncryptionSchemes = extension.blindEncryptionSchemes ? asStringArray(extension.blindEncryptionSchemes) : [];
    const blindPublicKeys = extension.blindPublicKeys && isRecord(extension.blindPublicKeys) ? extension.blindPublicKeys as { [scheme: string]: string } : {};
    const blindExecution = extension.blindExecution === true;
    const resultTtlMs = typeof extension.resultTtlMs === "number" ? extension.resultTtlMs : undefined;
    const declared = verifiableCapability(this.capabilities)?.proofFormats ?? [];
    const proofFormats = formats.filter((format) => declared.includes(format));
    if (proofFormats.length === 0) throw new Error("no mutually supported proof format");
    if (this.teeNitroOption !== false && proofFormats.includes("tee-nitro-v1") && this.teeVerifier === undefined) {
      const blindKey = blindPublicKeys["hpke-v1"];
      const expectedUserData = (): Uint8Array | undefined => blindKey === undefined ? undefined : new Uint8Array(createHash("sha256").update(unb64u(blindKey)).digest());
      this.teeVerifier = this.teeNitroOption ? new TeeNitroVerifier({ expectedUserData, ...this.teeNitroOption }) : TeeNitroVerifier.fromMockFixtures(mockNitroFixturesDir(), { expectedUserData });
    }
    const tools = asRecord((await this.request("tools/list", {})).result).tools;
    if (!Array.isArray(tools)) throw new Error("malformed tools/list response");
    const descriptors = new Map<string, ToolDescriptorMeta>();
    for (const item of tools) {
      const tool = asRecord(item);
      const name = asString(tool.name);
      const extensionMeta = isRecord(tool._meta) ? tool._meta[EXTENSION_ID] : undefined;
      if (!isRecord(extensionMeta)) continue;
      const descriptor = extensionMeta as unknown as ToolDescriptorMeta;
      const expected = expectedCircuitHash(name);
      const formats = isRecord(descriptor.formats) ? Object.entries(descriptor.formats) : [];
      const validFormats = Object.fromEntries(formats.filter(([, value]) => isRecord(value)).map(([format, value]) => {
        const entry = value as { [key: string]: JsonValue };
        return [format, {
          ...(typeof entry.circuitHash === "string" ? { circuitHash: entry.circuitHash } : {}),
          ...(typeof entry.verificationKeyUri === "string" ? { verificationKeyUri: entry.verificationKeyUri } : {})
        }];
      }));
      if (descriptor.circuitHash !== expected || formats.some(([format, value]) => isRecord(value) && typeof value.circuitHash === "string" && PINNED_CIRCUITS[name]?.formats?.[format] !== undefined && value.circuitHash !== expectedCircuitHash(name, format))) throw new Error(`tool descriptor circuitHash mismatch for ${name}`);
      descriptors.set(name, { ...descriptor, formats: validFormats });
    }
    this.descriptors = descriptors;
    this.discovered = { proofFormats, serverProofFormats: formats, blindPublicKeys, blindEncryptionSchemes, blindExecution, resultTtlMs };
    return this.discovered;
  }
  descriptor(tool: string): ToolDescriptorMeta | undefined { return this.descriptors.get(tool); }
  setCapabilities(capability: VerifiableToolsCapability, tasks = false): void { this.capabilities = clientCapabilities(capability.proofFormats ?? [], { blindExecution: capability.blindExecution, requireProof: capability.requireProof, requireInputProvenance: capability.requireInputProvenance, tasks }); }
  addProvenanceVerifier(verifier: ProvenanceVerifier): void { this.provenanceVerifiers.push(verifier); }
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
    if (meta?.proofFormat === "tee-nitro-v1" && this.teeVerifier === undefined && this.teeNitroOption !== false) {
      if (this.discovered === undefined) await this.discover();
    }
    const formats = verifiableCapability(this.capabilities)?.proofFormats ?? [];
    const verifiers: Verifier[] = [
      ...(formats.includes("snarkjs-v2") ? [this.snarkjsVerifier] : []),
      ...(formats.includes("noir-v1") ? [this.noirVerifier] : []),
      ...(formats.includes("risc0-v1") ? [this.risc0Verifier] : []),
      ...(formats.includes("ezkl-v1") ? [this.ezklVerifier] : []),
      ...(formats.includes("demo-sig-v1") ? [this.sigVerifier] : []),
      ...(formats.includes("demo-commit-v1") ? [this.commitVerifier] : []),
      ...(this.teeVerifier && formats.includes("tee-nitro-v1") ? [this.teeVerifier] : []),
      ...this.extraVerifiers.filter((verifier) => formats.includes(verifier.format))
    ];
    const descriptor = this.descriptors.get(tool);
    const format = meta?.proofFormat;
    const verificationKeyUri = format === undefined || descriptor === undefined
      ? undefined
      : descriptor.formats?.[format]?.verificationKeyUri ?? descriptor.verificationKeyUri;
    const formatHash = format === undefined ? undefined : descriptor?.formats?.[format]?.circuitHash;
    return verifyResult(meta, { arguments: args, content: result.content, nonce: options.nonce, salt: options.salt, expectedCircuitHash: formatHash ?? expectedCircuitHash(tool, format), verificationKeyUri, registry: this.registry }, verifiers,
      { required: verifiableCapability(this.capabilities)?.requireInputProvenance === true && descriptor?.externalInputs === true, verifiers: this.provenanceVerifiers, registry: this.registry });
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
    if (this.rpc) return this.rpc(method, params);
    const headers: Record<string, string> = { "content-type": "application/json", "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": method };
    if (method === "tools/call") headers["Mcp-Name"] = String(asRecord(params).name);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
    const response = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }), signal });
    return await response.json() as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
  }
}
export interface TaskEnvelope { resultType: "task"; taskId: string; status: string; pollIntervalMs: number; ttlMs?: number; }
function isTask(value: unknown): value is TaskEnvelope { return isRecord(value) && value.resultType === "task" && typeof value.taskId === "string"; }
function asRecord(value: unknown): { [key: string]: JsonValue } { if (!isRecord(value)) throw new Error("malformed JSON response"); return value; }
function asString(value: JsonValue | undefined): string { if (typeof value !== "string") throw new Error("malformed discovery response"); return value; }
function asStringArray(value: JsonValue | undefined): string[] { if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("malformed discovery response"); return value; }
