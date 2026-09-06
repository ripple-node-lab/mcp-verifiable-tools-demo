import { X509Certificate, createPublicKey, verify as verifySignature } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CborValue, VerifiableToolsMeta, cborDecode, coseSign1Decode } from "@demo/protocol";
import { pemToDer } from "@demo/prover";
import { Verifier, VerifyContext } from "./verifier.js";

export type TeeNitroFailure = "attestationMalformed" | "chainInvalid" | "measurementMismatch" | "userDataMismatch" | "nonceMismatch" | "attestationStale" | "signatureInvalid";
export type TeeNitroOutcome = { ok: true } | { ok: false; reason: TeeNitroFailure };
export interface TeeNitroVerifierOptions {
  rootCertPem: string;
  pinnedPcrs: (circuitHash: string) => Record<string, string> | undefined;
  expectedUserData?: () => Uint8Array | undefined;
  maxAgeMs?: number;
  now?: () => number;
}

interface NitroDoc {
  moduleId: string;
  timestamp: number;
  pcrs: Map<number, Uint8Array>;
  certificate: Uint8Array;
  cabundle: Uint8Array[];
  publicKey: Uint8Array;
  userData: Uint8Array;
  nonce: Uint8Array;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function getBytes(map: Map<CborValue, CborValue>, key: string): Uint8Array | undefined {
  const value = map.get(key);
  return value instanceof Uint8Array ? value : undefined;
}

function parseDoc(payload: Uint8Array): NitroDoc {
  const value = cborDecode(payload);
  if (!(value instanceof Map)) throw new Error("not a map");
  const moduleId = value.get("module_id");
  const timestamp = value.get("timestamp");
  const digest = value.get("digest");
  const pcrsValue = value.get("pcrs");
  const certificate = getBytes(value, "certificate");
  const cabundleValue = value.get("cabundle");
  const publicKey = getBytes(value, "public_key");
  const userData = getBytes(value, "user_data");
  const nonce = getBytes(value, "nonce");
  if (typeof moduleId !== "string" || typeof timestamp !== "number" || digest !== "SHA384" || !(pcrsValue instanceof Map) || !certificate || !Array.isArray(cabundleValue) || !publicKey || !userData || !nonce) throw new Error("malformed document");
  const pcrs = new Map<number, Uint8Array>();
  for (const [index, bytes] of pcrsValue) {
    if (typeof index !== "number" || !(bytes instanceof Uint8Array)) throw new Error("malformed pcrs");
    pcrs.set(index, bytes);
  }
  const cabundle: Uint8Array[] = [];
  for (const entry of cabundleValue) {
    if (!(entry instanceof Uint8Array)) throw new Error("malformed cabundle");
    cabundle.push(entry);
  }
  return { moduleId, timestamp, pcrs, certificate, cabundle, publicKey, userData, nonce };
}

export class TeeNitroVerifier implements Verifier {
  readonly format = "tee-nitro-v1";
  private readonly rootDer: Uint8Array;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  constructor(private readonly options: TeeNitroVerifierOptions) {
    this.rootDer = new Uint8Array(new X509Certificate(pemToDer(options.rootCertPem)).raw);
    this.maxAgeMs = options.maxAgeMs ?? 300_000;
    this.now = options.now ?? Date.now;
  }
  static fromMockFixtures(dir: string, extra: Partial<TeeNitroVerifierOptions> = {}): TeeNitroVerifier {
    const pcrs = JSON.parse(readFileSync(join(dir, "pcrs.json"), "utf8")) as Record<string, string>;
    return new TeeNitroVerifier({ rootCertPem: readFileSync(join(dir, "root.pem"), "utf8"), pinnedPcrs: () => pcrs, ...extra });
  }
  async verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean> {
    return (await this.verifyDetailed(meta, context)).ok;
  }
  async verifyDetailed(meta: VerifiableToolsMeta, context: VerifyContext): Promise<TeeNitroOutcome> {
    const fail = (reason: TeeNitroFailure): TeeNitroOutcome => ({ ok: false, reason });
    let doc: NitroDoc;
    let sign1: ReturnType<typeof coseSign1Decode>;
    try {
      if (typeof meta.teeAttestation !== "string" || !meta.teeAttestation.startsWith("0x")) throw new Error("missing attestation");
      sign1 = coseSign1Decode(new Uint8Array(Buffer.from(meta.teeAttestation.slice(2), "hex")));
      doc = parseDoc(sign1.payload);
    } catch { return fail("attestationMalformed"); }
    const now = this.now();
    let leaf: X509Certificate;
    try {
      leaf = new X509Certificate(new Uint8Array(doc.certificate));
      const root = this.chain(leaf, doc.cabundle, now);
      if (!root) return fail("chainInvalid");
    } catch { return fail("chainInvalid"); }
    try {
      if (!verifySignature("sha384", sign1.toBeSigned, { key: leaf.publicKey, dsaEncoding: "ieee-p1363" }, sign1.signature)) return fail("signatureInvalid");
    } catch { return fail("signatureInvalid"); }
    const pins = meta.circuitHash ? this.options.pinnedPcrs(meta.circuitHash) : undefined;
    if (!pins) return fail("measurementMismatch");
    for (const [index, hex] of Object.entries(pins)) {
      const value = doc.pcrs.get(Number(index));
      if (!value || !bytesEqual(value, new Uint8Array(Buffer.from(hex, "hex")))) return fail("measurementMismatch");
    }
    const expected = this.options.expectedUserData?.();
    if (expected !== undefined && !bytesEqual(doc.userData, expected)) return fail("userDataMismatch");
    const expectedNonce = context.nonce === undefined ? new Uint8Array() : new Uint8Array(Buffer.from(context.nonce.slice(2), "hex"));
    if (!bytesEqual(doc.nonce, expectedNonce)) return fail("nonceMismatch");
    if (Math.abs(now - doc.timestamp) > this.maxAgeMs) return fail("attestationStale");
    try {
      const enclaveKey = createPublicKey({ key: doc.publicKey, format: "der", type: "spki" });
      const signature = Buffer.from((meta.proof ?? "").slice(2), "hex");
      const message = Buffer.from((meta.circuitHash ?? "") + (meta.inputCommitment ?? "") + (meta.outputCommitment ?? "") + (meta.nonce ?? "0x"));
      const publicInputsOk = Array.isArray(meta.publicInputs) && meta.publicInputs.length === 3 &&
        meta.publicInputs[0] === meta.outputCommitment && meta.publicInputs[1] === meta.inputCommitment && meta.publicInputs[2] === (meta.nonce ?? "0x");
      if (!publicInputsOk || !verifySignature(null, message, enclaveKey, signature)) return fail("signatureInvalid");
    } catch { return fail("signatureInvalid"); }
    return { ok: true };
  }
  private chain(leaf: X509Certificate, cabundle: Uint8Array[], now: number): X509Certificate | undefined {
    const pool = cabundle.map((bytes) => new X509Certificate(new Uint8Array(bytes)));
    let current = leaf;
    const valid = (cert: X509Certificate): boolean => Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo);
    for (let hops = 0; hops <= pool.length; hops++) {
      if (!valid(current)) return undefined;
      if (bytesEqual(new Uint8Array(current.raw), this.rootDer)) return current;
      const issuer = pool.find((candidate) => current.issuer === candidate.subject && current.verify(candidate.publicKey));
      if (!issuer) return undefined;
      current = issuer;
    }
    return undefined;
  }
}
