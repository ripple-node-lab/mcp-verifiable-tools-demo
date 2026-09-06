import { PINNED_CIRCUITS } from "@demo/protocol";

export const FORMAT = "snarkjs-v2";
export const circuitHash = PINNED_CIRCUITS.add.formats?.[FORMAT] ?? PINNED_CIRCUITS.add.default;
