import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { hpkeOpen, hpkeSeal } from "@demo/protocol";
const hex = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "hex"));
test("HPKE RFC 9180 A.1.1 vector and round trip", () => {
  const skE = createPrivateKey({ key: { kty: "OKP", crv: "X25519", x: "N_2jVnvb1ijohmjDyNfpfR0SU7bU6m1EwVD3QfG_RDE", d: "UsSnWKgCzYuTbs7qMUQyeY1bry1-kjXcCEqxuc-i9zY" }, format: "jwk" });
  const skR = createPrivateKey({ key: { kty: "OKP", crv: "X25519", x: "OUjP4K0d22ldeA5ZB3GV2mxWUGsCcyl5SrAryoCBXE0", d: "RhLFUCY_yK1YN13z9VeqxTHSaFCQPlWp8j8h2FNOisg" }, format: "jwk" });
  const info = new TextEncoder().encode("Ode on a Grecian Urn");
  const aad = new TextEncoder().encode("Count-0");
  const plaintext = new TextEncoder().encode("Beauty is truth, truth beauty");
  const sealed = hpkeSeal(hex("3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d"), info, aad, plaintext, { privateKey: skE, publicKeyRaw: hex("37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431") });
  assert.equal(Buffer.from(sealed.slice(0, 32)).toString("hex"), "37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431");
  assert.equal(Buffer.from(sealed.slice(32)).toString("hex"), "f938558b5d72f1a23810b4be2ab4f84331acc02fc97babc53a52ae8218a355a96d8770ac83d07bea87e13c512a");
  assert.equal(new TextDecoder().decode(hpkeOpen(skR, hex("3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d"), info, aad, sealed)), "Beauty is truth, truth beauty");
  assert.throws(() => hpkeOpen(skR, hex("3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d"), info, new TextEncoder().encode("wrong"), sealed));
});
test("HPKE random round trip", () => {
  const recipient = generateKeyPairSync("x25519");
  const raw = new Uint8Array(Buffer.from((recipient.publicKey.export({ type: "spki", format: "jwk" }) as { x: string }).x, "base64url"));
  const sealed = hpkeSeal(raw, new Uint8Array(), new Uint8Array(), new TextEncoder().encode("hello"));
  assert.equal(new TextDecoder().decode(hpkeOpen(recipient.privateKey, raw, new Uint8Array(), new Uint8Array(), sealed)), "hello");
});
