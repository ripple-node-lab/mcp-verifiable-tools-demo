# Extension candidate notes / Extension Candidates

[`docs/PLAN.md`](PLAN.md) is kept **engine-agnostic**; suggestions that derive
from specific products or specific cases are collected here instead.
Entries in this document only indicate "where in PLAN they could land"; nothing
is adopted yet. Anything that is adopted goes through the proposal process of
[issue #2](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/2)
(PLAN §8), moves into PLAN / the spec, and is removed from this list.

Each candidate is recorded in the following form:

- **Source**: research issue / external material
- **Implication**: which PLAN design principle, Phase, or open question it relates to
- **How it would land**: the concrete diff to PLAN / the spec if adopted
- **Prerequisites / unverified**: what must be checked before an adoption decision

---

## 1. Shared Noir frontend + swappable backends (World ProveKit as an example)

- **Source**: [#7 World ProveKit research and implications](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/7) (World Foundation blog 2026-09-02, [worldfnd/provekit](https://github.com/worldfnd/provekit), MIT)
- **Implication**: Demonstration material for PLAN §2 "the essence is how proofs are transported / the backend is swappable". If the Noir circuit adopted in Phase 2-b is kept as the circuit frontend, Barretenberg (UltraHonk) and ProveKit (WHIR + Spartan variant, transparent, 128-bit PQ) can sit side by side as **two `proofFormat`s for the same `.nr` circuit**.
- **How it would land**:
  - PLAN §5 Phase 2-b: keep Noir circuits in `circuits/noir/`; keep only engine-specific artifacts (`vk`, `.pkv`) per engine.
  - PLAN §5 Phase 3: add `provekit-v1` as a CLI sidecar around `provekit-cli prepare / prove / verify` (`circuitHash` = hash of the `.pkv`, `verificationKeyUri` points at the `.pkv`). Verification via a `verifier-server` sidecar or a `provekit-verifier` WASM build (feasibility TBD by a Phase-3 PoC, same as risc0).
  - PLAN §5.1: add a "transparent / PQ SNARK" row.
  - Spec: add `provekit-v1` to the `proofFormats` examples (following the `"{engine}-{majorVersion}"` convention).
- **Prerequisites / unverified**:
  - WASM / npm distribution status of `provekit-verifier` / its FFI (whether TS in-process verification is possible).
  - The `v1` branch is a stable API; `main` / v2 (Goldilocks migration) changes proof / key formats → `proofFormat` major-version negotiation tests are needed.
  - Proof size stays under 1 MB but can exceed the `_meta` inline limit, so Phase 2-a (1) `proofUri` must land first.

## 2. Per-`proofFormat` trust-assumption metadata (`trustAssumptions`)

- **Source**: #7 §3.5
- **Implication**: the spec's Security Considerations cover key-distribution integrity, but for formats with a trusted setup (Groth16 / `snarkjs-v2`) the setup ceremony's trustworthiness is also a verifier assumption. Transparency, PQ security, and verification succinctness differ per format, and clients currently have no information to decide on.
- **How it would land**: note alongside PLAN §7 open question "`proofFormat` registry". Two options: put a `trustAssumptions` equivalent (`trustedSetup: bool`, `postQuantum: bool`, `succinctVerification: bool`, …) on the capability, or make it a table in the format registry. Groth16 (has setup, non-PQ, constant-time verification) and ProveKit (no setup, PQ, linear-in-circuit-size verification) are polar opposites, so implementing both would give a concrete example for the discussion.
- **Prerequisites / unverified**: the registry's shape (spec Open Questions) must be decided first.

## 3. Bidirectional proofs (client-attested inputs)

- **Source**: #7 §3.3
- **Implication**: in a blind call the party holding the secret input is the client. Adopting the "the party holding the secret proves on the spot" model (the direction ProveKit showed with client-side proving) makes a reverse-direction proof natural: **the client attaches a proof about its own input and hands it to the server**.
- **How it would land**: add to the spec's Open Questions. On the PLAN side, either spin up a Phase that adds an `inputProof`-equivalent to the request `_meta` of §4.1 `verifiable-tools/call`, or leave it as an open question.
- **Prerequisites / unverified**: division of roles with the existing `inputAttestations` (`zktls-tlsn-v1` etc., which are data-provider-side proofs). Whether the server-side verifier may be sidecar-shaped (PLAN §2 language policy).

## 4. Servers returning multiple `proofFormat`s for the same circuit

- **Source**: #7 §3.6 (ProveKit v2 roadmap: Groth16 backend / recursive wrapping)
- **Implication**: routes like "prove in a transparent format → fold into Groth16 → verify on-chain" turn into a use case where the server offers multiple formats for the same circuit and the client picks via `requestedProofFormat`.
- **How it would land**: add a `requestedProofFormat` selection test to PLAN §4.3 (each format's `circuitHash` matching `tools/list`'s `formats`). Same branch as risc0 receipt → Groth16 compression (PLAN §5.1).
- **Prerequisites / unverified**: none (expressible within the current spec).

---

## Recorded candidates

| # | Candidate | Related PLAN section | Status |
|---|---|---|---|
| 1 | Shared Noir frontend + `provekit-v1` sidecar | §2, §5 Phase 2-b / 3, §5.1 | Undecided |
| 2 | `trustAssumptions` metadata | §7 | Undecided |
| 3 | client-attested inputs | §4.1, spec Open Questions | Undecided |
| 4 | multiple `proofFormat`s for one circuit | §4.3 | Undecided |
