import { createCipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { JsonValue } from "@demo/protocol";
import { canonicalJson } from "@demo/prover";
export interface EncryptedArgumentsResult {
  encryptedArguments: string;
  inputCommitment: string;
}
export function encryptArguments(args: JsonValue, serverBlindPublicKeyBase64: string): EncryptedArgumentsResult {
  const keyPair = generateKeyPairSync("x25519");
  const publicJwk = keyPair.publicKey.export({ type: "spki", format: "jwk" }) as { x?: string };
  const serverPublic = createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: Buffer.from(serverBlindPublicKeyBase64, "base64").toString("base64url") },
    format: "jwk"
  });
  const shared = diffieHellman({ privateKey: keyPair.privateKey, publicKey: serverPublic });
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
  return {
    encryptedArguments: Buffer.from(JSON.stringify(envelope)).toString("base64"),
    inputCommitment: `0x${createHash("sha256").update(canonicalJson(args)).digest("hex")}`
  };
}
