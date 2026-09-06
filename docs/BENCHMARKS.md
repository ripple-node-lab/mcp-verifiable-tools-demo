# Phase 2-b benchmarks

Generated: 2026-09-06T07:27:42.665Z
Machine: devin-box (linux 5.15.200, x64, 2 CPUs)
Node: v20.18.1
Packages: snarkjs 0.7.6; noir_js 1.0.0-beta.26; bb.js 5.2.0

Ten sequential `{a:20,b:22}` calls per format. Prove time includes the in-process server call; verify time is client-side verification.

| Format | Median prove ms | P90 prove ms | Median verify ms | Proof bytes | VK document bytes | Prover artifact bytes | RSS delta bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| snarkjs-v2 | 135.97 | 143.24 | 9.82 | 722 | 3297 | 75646 | 35614720 |
| noir-v1 | 137.05 | 139.18 | 5.67 | 14656 | 4935 | 1260 | 107524096 |
| demo-sig-v1 | 0.93 | 0.95 | 0.31 | 64 | 113 | 0 | 0 |
| demo-commit-v1 | 0.82 | 1.01 | 0.05 | 32 | 113 | 0 | 126976 |

## Reproduction

```sh
npm ci
npm run build
npm run bench
```

The Circom trusted setup is a local, single-party, insecure demo ceremony; it is not production-secure. bb.js prints one proof-generation status line to stdout per proof in this version.
