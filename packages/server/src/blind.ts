import { createDecipheriv, createPublicKey, diffieHellman, hkdfSync } from "node:crypto";
import { JsonValue } from "@demo/protocol";
import { DemoCommitProver, DemoSigProver, Prover } from "@demo/prover";
import { circuitHash, executeTool, inputCommitment, makeResult, ToolName } from "./tools.js";
interface EncryptedArguments { epk: string; iv: string; ciphertext: string; tag: string; }
export function decryptArguments(value: string, state: { privateKey: import("node:crypto").KeyObject }): JsonValue {
  const envelope = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as EncryptedArguments;
  const epk = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: Buffer.from(envelope.epk, "base64").toString("base64url") }, format: "jwk" });
  const shared = diffieHellman({ privateKey: state.privateKey, publicKey: epk });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from("x25519-aesgcm-demo-v1"), 32));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8")) as JsonValue;
}
export function blindResult(tool: ToolName, encryptedArguments: string, commitment: string, requestedFormat: string | undefined, state: { privateKey: import("node:crypto").KeyObject }, verificationKeyUri: string): ReturnType<typeof makeResult> {
  const args = decryptArguments(encryptedArguments, state);
  if (inputCommitment(args) !== commitment) throw new Error("inputCommitment does not match encrypted arguments");
  const execution = executeTool(tool, args);
  const prover: Prover = requestedFormat === "demo-commit-v1" ? new DemoCommitProver() : new DemoSigProver();
  const proof = prover.prove({ circuitHash: circuitHash(tool), inputCommitment: commitment, output: execution.output });
  if (proof.verificationKeyUri === "") proof.verificationKeyUri = verificationKeyUri;
  return makeResult(execution.output, { "io.modelcontextprotocol/verifiable-tools": proof as unknown as JsonValue });
}
