import { verify as verifySignature } from "node:crypto";
import { IncomingMessage, Server, ServerResponse, createServer } from "node:http";
import { DemoSigProver, ProveInput } from "@demo/prover";
import { VerifiableToolsMeta } from "@demo/protocol";

export const SIDECAR_FORMAT = "demo-sig-sidecar-v1";
const MAX_BODY = 64 * 1024;

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_BODY) { request.destroy(); throw new Error("body too large"); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

export function createMockSidecarServer(): { server: Server; prover: DemoSigProver } {
  const prover = new DemoSigProver(SIDECAR_FORMAT);
  const pem = String(prover.publicKey.export({ type: "spki", format: "pem" }));
  const verifyMeta = (meta: VerifiableToolsMeta, expectedCircuitHash: string): { ok: boolean; reason?: string } => {
    if (meta.proofFormat !== SIDECAR_FORMAT || !meta.proof || !meta.circuitHash || !meta.inputCommitment || !meta.outputCommitment) return { ok: false, reason: "malformed meta" };
    if (meta.circuitHash !== expectedCircuitHash) return { ok: false, reason: "circuitHashMismatch" };
    const commits = (meta.inputAttestations ?? []).map((attestation) => (attestation as { commitment?: string }).commitment);
    const ok = verifySignature(null, Buffer.from(meta.circuitHash + meta.inputCommitment + meta.outputCommitment + (meta.nonce ?? "0x") + commits.join("")), prover.publicKey, Buffer.from(meta.proof.slice(2), "hex")) &&
      Array.isArray(meta.publicInputs) && meta.publicInputs.length === 3 + commits.length &&
      meta.publicInputs[0] === meta.outputCommitment && meta.publicInputs[1] === meta.inputCommitment && meta.publicInputs[2] === (meta.nonce ?? "0x") &&
      meta.publicInputs.slice(3).every((entry, i) => entry === commits[i]);
    return ok ? { ok: true } : { ok: false, reason: "signatureInvalid" };
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = request.url ?? "";
      if (request.method === "GET" && url === "/healthz") return sendJson(response, 200, { status: "ok", formats: [SIDECAR_FORMAT] });
      if (request.method === "GET" && url.startsWith("/vk/")) {
        response.statusCode = 200;
        response.setHeader("content-type", "application/x-pem-file");
        return response.end(pem);
      }
      if (request.method === "POST" && (url === "/prove" || url === "/verify")) {
        let body: unknown;
        try { body = JSON.parse(new TextDecoder().decode(await readBody(request))); }
        catch { return sendJson(response, 400, { error: "invalid JSON" }); }
        if (url === "/prove") {
          const input = body as ProveInput;
          try { return sendJson(response, 200, await prover.prove(input)); }
          catch { return sendJson(response, 400, { error: "prove failed" }); }
        }
        const record = body as { meta?: VerifiableToolsMeta; expectedCircuitHash?: string };
        if (!record.meta || typeof record.expectedCircuitHash !== "string") return sendJson(response, 400, { error: "invalid request" });
        return sendJson(response, 200, verifyMeta(record.meta, record.expectedCircuitHash));
      }
      return sendJson(response, 404, { error: "not found" });
    })().catch(() => { try { sendJson(response, 500, { error: "internal" }); } catch { /* closed */ } });
  });
  return { server, prover };
}

export async function startMockSidecar(port = 0, host = "127.0.0.1"): Promise<{ url: string; close(): Promise<void> }> {
  const { server } = createMockSidecarServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new Error("sidecar listen failed")));
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    url: `http://${host}:${boundPort}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
