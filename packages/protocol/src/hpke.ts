import {
  createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman,
  generateKeyPairSync, createHmac, KeyObject
} from "node:crypto";

const HPKE_VERSION = new TextEncoder().encode("HPKE-v1");
const KEM_ID = new Uint8Array([0x00, 0x20]);
const KDF_ID = new Uint8Array([0x00, 0x01]);
const AEAD_ID = new Uint8Array([0x00, 0x01]);
const KEM_SUITE_ID = concat(new TextEncoder().encode("KEM"), KEM_ID);
const HPKE_SUITE_ID = concat(new TextEncoder().encode("HPKE"), KEM_ID, KDF_ID, AEAD_ID);

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function i2osp(value: number, length: number): Uint8Array {
  const output = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index--) { output[index] = value & 0xff; value >>>= 8; }
  return output;
}

function labeledExtract(salt: Uint8Array, label: string, ikm: Uint8Array): Uint8Array {
  return hmacExtract(salt, concat(HPKE_VERSION, HPKE_SUITE_ID, new TextEncoder().encode(label), ikm));
}

function labeledExpand(prk: Uint8Array, label: string, info: Uint8Array, length: number): Uint8Array {
  return hkdfExpand(prk, concat(i2osp(length, 2), HPKE_VERSION, HPKE_SUITE_ID, new TextEncoder().encode(label), info), length);
}

function kemLabeledExtract(salt: Uint8Array, label: string, ikm: Uint8Array): Uint8Array {
  return hmacExtract(salt, concat(HPKE_VERSION, KEM_SUITE_ID, new TextEncoder().encode(label), ikm));
}

function kemLabeledExpand(prk: Uint8Array, label: string, info: Uint8Array, length: number): Uint8Array {
  return hkdfExpand(prk, concat(i2osp(length, 2), HPKE_VERSION, KEM_SUITE_ID, new TextEncoder().encode(label), info), length);
}

function hmacExtract(salt: Uint8Array, ikm: Uint8Array): Uint8Array {
  const key = salt.length === 0 ? new Uint8Array(32) : salt;
  return new Uint8Array(createHmac("sha256", key).update(ikm).digest());
}

function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const output = new Uint8Array(length);
  let previous = new Uint8Array();
  let offset = 0;
  for (let counter = 1; offset < length; counter++) {
    previous = new Uint8Array(createHmac("sha256", prk).update(concat(previous, info, new Uint8Array([counter]))).digest());
    output.set(previous.slice(0, Math.min(previous.length, length - offset)), offset);
    offset += Math.min(previous.length, length - offset);
  }
  return output;
}

function extractAndExpand(dh: Uint8Array, kemContext: Uint8Array): Uint8Array {
  const eaePrk = kemLabeledExtract(new Uint8Array(), "eae_prk", dh);
  return kemLabeledExpand(eaePrk, "shared_secret", kemContext, 32);
}

function keySchedule(sharedSecret: Uint8Array, info: Uint8Array): { key: Uint8Array; baseNonce: Uint8Array } {
  const pskIdHash = labeledExtract(new Uint8Array(), "psk_id_hash", new Uint8Array());
  const infoHash = labeledExtract(new Uint8Array(), "info_hash", info);
  const context = concat(new Uint8Array([0]), pskIdHash, infoHash);
  const secret = labeledExtract(sharedSecret, "secret", new Uint8Array());
  return {
    key: labeledExpand(secret, "key", context, 16),
    baseNonce: labeledExpand(secret, "base_nonce", context, 12)
  };
}

export function rawX25519Public(key: KeyObject): Uint8Array {
  const jwk = key.export({ type: "spki", format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("missing X25519 public key");
  return unb64u(jwk.x);
}

export function x25519FromRaw(raw: Uint8Array): KeyObject {
  if (raw.length !== 32) throw new Error("X25519 public key must be 32 bytes");
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64u(raw) }, format: "jwk" });
}

export function b64u(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function unb64u(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function encap(recipientPublicKey: KeyObject, recipientPublicKeyRaw: Uint8Array, ephemeral?: { privateKey: KeyObject; publicKeyRaw: Uint8Array }): { enc: Uint8Array; sharedSecret: Uint8Array } {
  let privateKey: KeyObject;
  let publicKeyRaw: Uint8Array;
  if (ephemeral) {
    privateKey = ephemeral.privateKey;
    publicKeyRaw = ephemeral.publicKeyRaw;
  } else {
    const pair = generateKeyPairSync("x25519");
    privateKey = pair.privateKey;
    publicKeyRaw = rawX25519Public(pair.publicKey);
  }
  const enc = publicKeyRaw;
  const dh = diffieHellman({ privateKey, publicKey: recipientPublicKey });
  return { enc, sharedSecret: extractAndExpand(new Uint8Array(dh), concat(enc, recipientPublicKeyRaw)) };
}

export function hpkeSeal(recipientPublicKeyRaw: Uint8Array, info: Uint8Array, aad: Uint8Array, plaintext: Uint8Array, ephemeral?: { privateKey: KeyObject; publicKeyRaw: Uint8Array }): Uint8Array {
  const recipientPublicKey = x25519FromRaw(recipientPublicKeyRaw);
  const { enc, sharedSecret } = encap(recipientPublicKey, recipientPublicKeyRaw, ephemeral);
  const { key, baseNonce } = keySchedule(sharedSecret, info);
  const cipher = createCipheriv("aes-128-gcm", key, baseNonce);
  cipher.setAAD(aad);
  return concat(enc, new Uint8Array(concat(cipher.update(plaintext), cipher.final(), cipher.getAuthTag())));
}

export function hpkeOpen(recipientPrivateKey: KeyObject, recipientPublicKeyRaw: Uint8Array, info: Uint8Array, aad: Uint8Array, encAndCiphertext: Uint8Array): Uint8Array {
  if (encAndCiphertext.length < 32 + 16) throw new Error("invalid HPKE ciphertext");
  const enc = encAndCiphertext.slice(0, 32);
  const ciphertext = encAndCiphertext.slice(32);
  const ephemeralPublicKey = x25519FromRaw(enc);
  const dh = diffieHellman({ privateKey: recipientPrivateKey, publicKey: ephemeralPublicKey });
  const sharedSecret = extractAndExpand(new Uint8Array(dh), concat(enc, recipientPublicKeyRaw));
  const { key, baseNonce } = keySchedule(sharedSecret, info);
  const decipher = createDecipheriv("aes-128-gcm", key, baseNonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(ciphertext.slice(-16));
  return new Uint8Array(concat(decipher.update(ciphertext.slice(0, -16)), decipher.final()));
}
