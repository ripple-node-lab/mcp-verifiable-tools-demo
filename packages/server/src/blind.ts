import { createDecipheriv, createPublicKey, diffieHellman, KeyObject, hkdfSync } from "node:crypto";
import { isRecord, JsonRpcProtocolError, JsonValue } from "@demo/protocol";
interface EncryptedArguments { epk: string; iv: string; ciphertext: string; tag: string; }
export function decryptArguments(value: string, state: { privateKey: KeyObject }): JsonValue {
  if (value.length > 128 * 1024) throw new JsonRpcProtocolError(-32602, "invalid encrypted arguments");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
  } catch {
    throw new JsonRpcProtocolError(-32602, "invalid encrypted arguments");
  }
  if (!isRecord(parsed)) throw new JsonRpcProtocolError(-32602, "invalid encrypted arguments");
  const fields = ["epk", "iv", "ciphertext", "tag"] as const;
  if (!fields.every((field) => typeof parsed[field] === "string")) {
    throw new JsonRpcProtocolError(-32602, "invalid encrypted arguments");
  }
  const envelope = parsed as unknown as EncryptedArguments;
  if (envelope.epk.length > 64 || envelope.iv.length > 32 || envelope.tag.length > 32 || envelope.ciphertext.length > 64 * 1024) {
    throw new JsonRpcProtocolError(-32602, "invalid encrypted arguments");
  }
  try {
    const epkBytes = Buffer.from(envelope.epk, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    if (epkBytes.length !== 32 || iv.length !== 12 || tag.length !== 16) {
      throw new Error("invalid encrypted arguments");
    }
    const epk = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: epkBytes.toString("base64url") }, format: "jwk" });
    const shared = diffieHellman({ privateKey: state.privateKey, publicKey: epk });
    const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from("x25519-aesgcm-demo-v1"), 32));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8")) as JsonValue;
  } catch {
    throw new JsonRpcProtocolError(-32602, "invalid encrypted arguments");
  }
}
