import { Barretenberg } from "@aztec/bb.js";
import { PINNED_CIRCUITS } from "@demo/protocol";

export const FORMAT = "noir-v1";
export const circuitHash = PINNED_CIRCUITS.add.formats?.[FORMAT] ?? PINNED_CIRCUITS.add.default;
let apiPromise: Promise<Barretenberg> | undefined;

export async function getApi(): Promise<Barretenberg> {
  apiPromise ??= Barretenberg.new({ threads: 1 }).catch((error) => {
    apiPromise = undefined;
    throw error;
  });
  return await apiPromise;
}
export async function destroy(): Promise<void> {
  const api = await apiPromise;
  apiPromise = undefined;
  await api?.destroy();
}
