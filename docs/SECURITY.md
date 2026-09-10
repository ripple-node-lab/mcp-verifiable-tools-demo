# Security notes

This repository is a reference/demo implementation of the
`io.modelcontextprotocol/verifiable-tools` extension. It is **not** suitable
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
  the endpoint can call any tool, claim any task by `taskId`, or prove any
  live `resultId`.
- Do not use this implementation for production security.
