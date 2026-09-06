import { SidecarHealth } from "./contract.js";

export async function sidecarHealth(baseUrl: string, timeoutMs = 5000): Promise<SidecarHealth> {
  const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`sidecar /healthz failed: ${response.status}`);
  const body = await response.json() as SidecarHealth;
  if (body.status !== "ok" || !Array.isArray(body.formats)) throw new Error("malformed /healthz response");
  return body;
}
