declare module "snarkjs" {
  import type { JsonValue } from "@demo/protocol";
  export const groth16: {
    fullProve(input: Record<string, number>, wasm: string, zkey: string, logger?: unknown, witnessOptions?: unknown, proverOptions?: { singleThread?: boolean }): Promise<{ proof: JsonValue; publicSignals: string[] }>;
    verify(verificationKey: JsonValue, publicSignals: string[], proof: JsonValue): Promise<boolean>;
  };
}
