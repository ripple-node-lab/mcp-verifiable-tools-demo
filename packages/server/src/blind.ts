import { createDecipheriv, createPublicKey, diffieHellman, KeyObject, hkdfSync } from "node:crypto";
import { JsonValue } from "@demo/protocol";
interface EncryptedArguments { epk: string; iv: string; ciphertext: string; tag: string; }
export function decryptArguments(value: string, state: { privateKey: KeyObject }): JsonValue {
  const envelope = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as EncryptedArguments;
  const epk = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: Buffer.from(envelope.epk, "base64").toString("base64url") }, format: "jwk" });
  const shared = diffieHellman({ privateKey: state.privateKey, publicKey: epk });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from("x25519-aesgcm-demo-v1"), 32));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8")) as JsonValue;
}
