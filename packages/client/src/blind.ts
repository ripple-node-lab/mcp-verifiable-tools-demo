import { generateKeyPairSync, randomBytes } from "node:crypto";
import { HPKE_INFO_ARGS, JsonValue, b64u, hpkeSeal, inputCommitment, jcs, unb64u } from "@demo/protocol";

export interface EncryptedArgumentsResult { encryptedArguments: string; inputCommitment: string; salt: Uint8Array; }
export function encryptArguments(args: JsonValue, serverBlindPublicKey: string): EncryptedArgumentsResult {
  const salt = randomBytes(32);
  const commitment = inputCommitment(args, salt);
  const payload = new TextEncoder().encode(jcs({ salt: `0x${salt.toString("hex")}`, arguments: args } as JsonValue));
  const aad = new TextEncoder().encode(jcs({ tool: "privateCreditCheck", inputCommitment: commitment, encryptionScheme: "hpke-v1" } as JsonValue));
  return { encryptedArguments: b64u(hpkeSeal(unb64u(serverBlindPublicKey), new TextEncoder().encode(HPKE_INFO_ARGS), aad, payload)), inputCommitment: commitment, salt };
}
export function generateReplyKeyPair(): { privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]; publicKey: Uint8Array } {
  const pair = generateKeyPairSync("x25519");
  const jwk = pair.publicKey.export({ type: "spki", format: "jwk" }) as { x?: string };
  return { privateKey: pair.privateKey, publicKey: unb64u(jwk.x ?? "") };
}
