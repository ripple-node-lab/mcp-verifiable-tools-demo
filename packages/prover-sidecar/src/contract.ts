// HTTP contract between the MCP server and a proving sidecar.
//   GET  /healthz          -> SidecarHealth
//   POST /prove            -> ProveInput -> VerifiableToolsMeta (JSON)
//   POST /verify           -> SidecarVerifyRequest -> SidecarVerifyResponse
//   GET  /vk/{circuitHash} -> PEM verification key (formats that expose one)
import { ProveInput } from "@demo/prover";
import { VerifiableToolsMeta } from "@demo/protocol";

export interface SidecarHealth { status: "ok"; formats: string[]; }
export interface SidecarVerifyRequest { meta: VerifiableToolsMeta; expectedCircuitHash: string; }
export interface SidecarVerifyResponse { ok: boolean; reason?: string; }
export type { ProveInput, VerifiableToolsMeta };

export const MAX_RESPONSE = 1 << 20;

export async function readJsonBounded(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE) throw new Error("sidecar response too large");
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_RESPONSE) throw new Error("sidecar response too large");
  return JSON.parse(new TextDecoder().decode(body));
}
