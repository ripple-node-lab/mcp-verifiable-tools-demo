# Phase 2-b benchmarks

Generated: 2026-09-06T07:53:51.885Z
Machine: devin-box (linux 5.15.200, x64, 2 CPUs)
Node: v20.18.1
Packages: snarkjs 0.7.6; noir_js 1.0.0-beta.26; bb.js 5.2.0

Ten sequential `{a:20,b:22}` calls per format. Prove time includes the in-process server call; verify time is client-side verification.

| Format | Median prove ms | P90 prove ms | Median verify ms | Proof bytes | VK document bytes | Prover artifact bytes | RSS delta bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| snarkjs-v2 | 143.03 | 150.84 | 9.17 | 725 | 3297 | 75646 | 73170944 |
| noir-v1 | 137.62 | 139.01 | 5.68 | 14656 | 4935 | 1260 | 139612160 |
| demo-sig-v1 | 0.95 | 1.04 | 0.31 | 64 | 113 | 0 | 2310144 |
| demo-commit-v1 | 0.86 | 1.04 | 0.05 | 32 | 113 | 0 | 2146304 |

## Reproduction

```sh
npm ci
npm run build
npm run bench
```

The Circom trusted setup is a local, single-party, insecure demo ceremony; it is not production-secure. bb.js prints one proof-generation status line to stdout per proof in this version.

# Phase 3 (sidecar formats) — figures recorded in the phase PRs

These numbers were recorded while landing each phase and are copied here from
the Phase 3-b/3-c/3-d rows of [PLAN.md](PLAN.md); they were not re-measured
for this document. Provers run in docker sidecars; verification runs
in-process (WASM) unless noted. Prover memory was not recorded for the sidecar
formats (`npm run bench` measures RSS only for in-process provers), so the
Phase 3 rows are incomplete against the spec's reporting requirement.

| Format / artifact | Prove time | Proof size | VK / artifact size | Verify time | Notes |
|---|---|---|---|---|---|
| `risc0-v1` composite receipt | ≈19 s (docker, CPU); ≈40–50 s bare metal | ≈222 KB | image ID 32 B (also the `circuitHash`) | ≈40–60 ms in-process WASM | dev-mode receipt ≈88 ms / 825 B; Groth16 compression (→≈0.2 KB) needs GPU / `risczero/risc0-groth16-prover`, not run |
| `ezkl-v1` Halo2-KZG | ≈2–3 s | ≈20 KB | vk 34 KB; SRS 2.1 MB committed; pk 117 MB regenerated at startup | ≈240 ms via `@ezkljs/engine` wasm (≈9.8 MB) | ezkl/engine versions must match exactly (22.0.1); inputs restricted to `a, b ∈ [0, 2^24]` |
| `zktls-tlsn-v1` attestation | attest ≈1 s (MPC-TLS setup ≈670 ms + request ≈93 ms + notarize ≈118 ms) | presentation bincode ≈5.3 KB | secp256k1 notary key, 33 B SEC1 | ≈0.2 ms in the Rust sidecar `/verify` | in-process TS verification not possible (`tlsn-core` needs `getrandom` on wasm32) |

## Reproduction (opt-in sidecar tests)

```sh
docker compose --profile risc0 up --build -d --wait
npm run build
RISC0_SIDECAR_URL=http://127.0.0.1:4200 node --test tests/dist/risc0-sidecar.test.js

docker compose --profile ezkl up --build -d --wait
EZKL_SIDECAR_URL=http://127.0.0.1:4300 node --test tests/dist/ezkl-sidecar.test.js

docker compose --profile tlsn up --build -d --wait
TLSN_SIDECAR_URL=http://127.0.0.1:4400 node --test tests/dist/tlsn-sidecar.test.js
```

Each `*_SIDECAR_URL` variable also enables the matching demo scenario in
`npm run demo` (risc0 → scenario 8, ezkl → 9, tlsn → 10).
