import { createPrivateKey, generateKeyPairSync, sign, KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CborValue, VerifiableToolsMeta, cborEncode, coseSign1Encode } from "@demo/protocol";
import { Prover, ProveInput, attestationCommits } from "./prover.js";

export interface TeeNitroProverOptions {
  leafCertPem: string;
  leafKeyPem: string;
  caBundlePem: string[];
  pcrs: Record<string, string>;
  moduleId?: string;
  userData?: Uint8Array;
  now?: () => number;
}

export function pemToDer(pem: string): Uint8Array {
  return new Uint8Array(Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64"));
}

export function mockNitroFixturesDir(): string {
  if (process.env.NITRO_MOCK_FIXTURES) return process.env.NITRO_MOCK_FIXTURES;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, "sidecars", "nitro", "mock-fixtures");
    if (existsSync(join(candidate, "root.pem"))) return candidate;
    dir = dirname(dir);
  }
  throw new Error("mock nitro fixtures not found (set NITRO_MOCK_FIXTURES)");
}

export class TeeNitroProver implements Prover {
  readonly format = "tee-nitro-v1";
  private readonly enclavePrivateKey: KeyObject;
  private readonly enclavePublicKeyDer: Uint8Array;
  private readonly leafKey: KeyObject;
  private readonly leafDer: Uint8Array;
  private readonly caBundleDer: Uint8Array[];
  private readonly pcrs: Map<number, Uint8Array>;
  private readonly moduleId: string;
  private readonly userData: Uint8Array;
  private readonly now: () => number;
  constructor(private readonly options: TeeNitroProverOptions) {
    const pair = generateKeyPairSync("ed25519");
    this.enclavePrivateKey = pair.privateKey;
    this.enclavePublicKeyDer = new Uint8Array(pair.publicKey.export({ type: "spki", format: "der" }) as Uint8Array);
    this.leafKey = createPrivateKey({ key: options.leafKeyPem, format: "pem" });
    this.leafDer = pemToDer(options.leafCertPem);
    this.caBundleDer = options.caBundlePem.map(pemToDer);
    this.pcrs = new Map(Object.entries(options.pcrs).map(([index, hex]) => [Number(index), new Uint8Array(Buffer.from(hex, "hex"))] as [number, Uint8Array]));
    this.moduleId = options.moduleId ?? "mock-nitro-enclave";
    this.userData = options.userData ?? new Uint8Array();
    this.now = options.now ?? Date.now;
  }
  static fromMockFixtures(dir: string, extra: Partial<TeeNitroProverOptions> = {}): TeeNitroProver {
    const pcrs = JSON.parse(readFileSync(join(dir, "pcrs.json"), "utf8")) as Record<string, string>;
    return new TeeNitroProver({
      leafCertPem: readFileSync(join(dir, "leaf.pem"), "utf8"),
      leafKeyPem: readFileSync(join(dir, "leaf-key.pem"), "utf8"),
      caBundlePem: [readFileSync(join(dir, "root.pem"), "utf8")],
      pcrs,
      ...extra
    });
  }
  async prove(input: ProveInput, options: { signal?: AbortSignal } = {}): Promise<VerifiableToolsMeta> {
    if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const commits = attestationCommits(input);
    const proof = sign(null, Buffer.from(input.circuitHash + input.inputCommitment + input.outputCommitment + (input.nonce ?? "0x") + commits.join("")), this.enclavePrivateKey);
    const doc = new Map<CborValue, CborValue>([
      ["module_id", this.moduleId],
      ["digest", "SHA384"],
      ["timestamp", this.now()],
      ["pcrs", new Map<CborValue, CborValue>([...this.pcrs.entries()] as [CborValue, CborValue][])],
      ["certificate", this.leafDer],
      ["cabundle", this.caBundleDer],
      ["public_key", this.enclavePublicKeyDer],
      ["user_data", this.userData],
      ["nonce", input.nonce ? new Uint8Array(Buffer.from(input.nonce.slice(2), "hex")) : new Uint8Array()]
    ]);
    const attestation = coseSign1Encode({
      protectedHeader: new Map<CborValue, CborValue>([[1, -35]]),
      payload: cborEncode(doc),
      sign: (toBeSigned) => new Uint8Array(sign("sha384", toBeSigned, { key: this.leafKey, dsaEncoding: "ieee-p1363" }))
    });
    return {
      proof: `0x${proof.toString("hex")}`,
      proofFormat: this.format,
      circuitHash: input.circuitHash,
      inputCommitment: input.inputCommitment,
      outputCommitment: input.outputCommitment,
      ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
      publicInputs: [input.outputCommitment, input.inputCommitment, input.nonce ?? "0x", ...commits],
      ...(commits.length === 0 ? {} : { inputAttestations: input.inputAttestations }),
      teeAttestation: `0x${Buffer.from(attestation).toString("hex")}`
    };
  }
}
