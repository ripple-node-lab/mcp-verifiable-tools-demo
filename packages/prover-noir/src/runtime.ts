import { Barretenberg } from "@aztec/bb.js";

export const FORMAT = "noir-v1";
export const circuitHash = "0x70d3e40690fb97fbcace5ce1d3114282e7dfff1387b125767b6a942e1ca3261e";
let apiPromise: Promise<Barretenberg> | undefined;

export async function getApi(): Promise<Barretenberg> {
  apiPromise ??= Barretenberg.new({ threads: 1 });
  return await apiPromise;
}
export async function destroy(): Promise<void> {
  const api = await apiPromise;
  apiPromise = undefined;
  await api?.destroy();
}
