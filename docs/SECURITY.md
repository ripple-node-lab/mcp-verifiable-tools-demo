# Security notes

This repository is a reference/demo implementation of the
`io.github.ripple-node-lab/verifiable-tools` extension. It is **not** suitable
for production security. The normative security analysis lives in the spec's
[Security Implications](spec/verifiable-tools.md#security-implications)
section; this file consolidates the demo-specific caveats.

## Demo-grade evidence

- `demo-sig-v1` and `demo-commit-v1` are teaching formats — an Ed25519
  signature and a SHA-256 commitment over the bound fields — **not**
  cryptographic zero-knowledge proofs. `demo-sig-sidecar-v1` is the same
  signature delivered through the sidecar contract.
- `oracle-sig-v1` input attestations are Ed25519 signatures issued by the
  demo's own in-process `OraclePriceFeed`; they demonstrate the provenance
  plumbing, not a real oracle.
- `hpke-v1` is RFC 9180 base mode implemented with `node:crypto`; it is
  provided for reference, not as a production security deployment.
- `zktls-tlsn-v1` attestations are real TLSNotary presentations, but the
  proven data comes from a loopback fixture host (`test-server.io`) standing
  in for a real exchange API, notarized by an in-process demo notary.

## Trusted setups, mocks, and input domains

- `snarkjs-v2` is a real Groth16 proof, but the checked-in proving key comes
  from an **insecure, single-party, local Powers of Tau ceremony** (see the
  rebuild notes in [DEMOS.md](DEMOS.md#appendix-rebuilding-circuit-artifacts)).
- `noir-v1` (UltraHonk) is a real proof and requires no trusted setup.
- `tee-nitro-v1` genuinely verifies the COSE_Sign1 attestation — certificate
  chain, PCR measurements, key binding via `user_data`, nonce echo, and
  freshness — but against a **mock** root CA and **mock** PCRs in
  `sidecars/nitro/mock-fixtures`, not the AWS Nitro Enclaves root.
- `ezkl-v1` restricts `add` inputs to `a, b ∈ [0, 2^24]`: ONNX FLOAT ingest is
  only exact below `2^24` (a `2^24 + 1` input is silently rounded and would
  produce a proof of the wrong value), and the circuit's range-check
  decomposition (base 16384, n = 2) caps at `2^28`. Out-of-domain arguments
  are rejected with `-32602`.
- `snarkjs-v2`, `noir-v1`, and `risc0-v1` require `a`, `b`, and the checked
  `u32` sum to fit in `[0, 2^32 - 1]`; invalid arguments are rejected with
  `-32602`.

## Proof absent vs. invalid

The client distinguishes three outcomes: `absent` means no usable evidence was
returned, `invalid` means evidence failed verification, and `verified` means all
checks passed. `verifyWithRequirement` applies the caller's `required`,
`preferred`, or `none` policy; `invalid` is never actionable, while `absent`
under `preferred` remains an explicit unverified state. An absent result from a
`proofPolicy: "always"` tool is a descriptor violation and a security event.
Servers that silently strip evidence can therefore cause a downgrade from
verified to absent; clients must not present that as verified. See the
[normative requirement section](spec/verifiable-tools.md#proof-requirement-and-verification-outcome).

## ZK proof binding

The ZK proof formats bind `outputCommitment`, `inputCommitment`, and `nonce`
into the proof itself, not just into `meta.publicInputs[0..3]`:

- `snarkjs-v2`: the circuit takes the three values as public inputs holding
  `commitmentToField(hex)` — `int(hex) mod` the BN254 scalar field — so the
  Groth16 public signals are `[c, a, b, out, in, nonce]` and
  `meta.publicInputs` echoes all 9.
- `noir-v1`: same scheme — public inputs `[a, b, out_commit, in_commit,
  nonce, c]` (9-element `meta.publicInputs`).
- `risc0-v1`: the journal commits `sha256(lowercased "0x…")` digests of the
  three values (108 bytes: `a || b || sum || out || in || nonce`); the
  `meta.publicInputs` tail stays `[sum, a, b]`.
- `ezkl-v1`: ONNX f32 inputs can't carry a 254-bit element exactly, so each
  value enters as 16 big-endian u16 limbs of `commitmentToField(hex)` — 51
  public instances `[a, b, ob*, ib*, nb*, sum]`; `meta.publicInputs` tail
  stays `[sum, a, b]`.

A captured proof therefore does not verify under a rewritten `meta` (fresh
nonce or different commitments) — replay protection holds at the proof layer
for all ZK formats. `demo-sig-v1`, `demo-commit-v1`, and `tee-nitro-v1`
likewise bind the nonce and commitments into the signed/attested payload,
satisfying the spec's §Result binding requirement.

## Trust anchors

- The client pins verification keys by `circuitHash` and rejects results
  whose tool-to-circuit mapping does not match its expected mapping. In a
  real deployment that mapping must come from an out-of-band trusted
  registry; this demo keeps it fixed in `packages/protocol`
  (`PINNED_CIRCUITS`). Keys fetched over HTTP (`verificationKeyUri`,
  `oracle-sig-v1` keys, the tlsn notary key) go through an
  origin-allowlisted registry (`packages/verifier/src/registry.ts`).
- The demo listens on plain `http://127.0.0.1` only. Any non-loopback
  deployment must use TLS, because discovery — including the blind public key
  and `verificationKeyUri` — can otherwise be replaced by a network attacker.
  The same applies to the sidecar URLs, which are plain HTTP on loopback.

## Lifecycle and session caveats

- Expired `resultId` values return `resultExpired` (`-32602`) for 2×TTL after
  expiry because the tombstone is retained, then `resultNotFound`.
- No principal or session binding is implemented: `resultId` handles are not
  bound to a caller, and the demo has no authentication. Anyone who can reach
  the endpoint can call any tool, claim any task by `taskId`, or prove any live
  `resultId`.
- **Authorization continuity:** a verified result does not prove the caller was
  entitled to supply the input `X`; authorization and execution integrity are
  separate checks. The demo's negative fixture compares `inputCommitment`
  against a fixed approved-argument commitment (tests/provenance.test.ts).
- Do not use this implementation for production security.
