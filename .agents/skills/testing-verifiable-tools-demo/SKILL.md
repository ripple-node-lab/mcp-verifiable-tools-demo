---
name: testing-verifiable-tools-demo
description: How to run the mcp-verifiable-tools-demo E2E demo and its docker sidecars (risc0/ezkl/tlsn) for runtime testing
---

# Testing the verifiable-tools demo end-to-end

Repo layout: npm workspaces under `packages/*`; `npm run demo` builds with `tsc -b`
then runs `packages/client/dist/src/main.js`, which starts `DemoServer`
in-process on a random port. No standalone server needed.

## Environment

- Node is NOT on PATH. Use `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"` (>=20.3 required).
- Docker sidecar images must be built once: `docker compose --profile <risc0|ezkl|tlsn> up --build -d --wait`.
- If the images already exist (`docker images | grep mcp-verifiable-tools-demo`), start containers directly:
  - `docker run --rm -d --name risc0 -p 4200:4200 mcp-verifiable-tools-demo-sidecar-risc0:latest`
  - `docker run --rm -d --name ezkl  -p 4300:4300 mcp-verifiable-tools-demo-sidecar-ezkl:latest`
- risc0: run WITHOUT `RISC0_DEV_MODE` — dev-mode fake receipts are rejected
  client-side (`proofInvalid`). Real proving ~20-60 s/proof. Check
  `curl localhost:4200/healthz` → `devMode:false`, `imageId` == pinned circuitHash.
- ezkl: container regenerates `pk.json` at startup (~1-2 min on first boot);
  wait for `circuitHash=` in `docker logs` or poll `/healthz`.

## Running

```sh
RISC0_SIDECAR_URL=http://127.0.0.1:4200 EZKL_SIDECAR_URL=http://127.0.0.1:4300 npm run demo
```

- Demo scenario 10 (zkTLS) needs `TLSN_SIDECAR_URL` + the tlsn profile image; otherwise it prints `skipped`.
- `DEMO_VERBOSE=0` for compact output; `DEMO_PAUSE=1` steps (TTY only).
- Sidecar-gated test suites: `RISC0_SIDECAR_URL=... node --test tests/dist/risc0-sidecar.test.js`
  (likewise `ezkl-sidecar.test.js`, `tlsn-sidecar.test.js`, `SIDECAR_URL` mock `sidecar.test.js`).

## Writing ad-hoc E2E scripts

Scripts must live INSIDE the repo (e.g. repo root) so `@demo/*` workspace
specifiers resolve; scripts in /tmp fail with ERR_MODULE_NOT_FOUND.
Useful imports: `startServer`/`DemoServer` from `@demo/server`,
`VerifiableClient` from `@demo/client` (`callTool(name,args,{proofFormat})`,
`verify(result,args,tool,{nonce})`), `EXTENSION_ID` from `@demo/protocol`.
Always clean up prover workers: `closeProverWorker` from `@demo/prover-snarkjs`,
`closeProverWorker` + `destroy` from `@demo/prover-noir`, then `server.close()`.

## Gotchas

- `meta.publicInputs` layout: `[outputCommitment, inputCommitment, nonce ?? "0x", ...tail]`
  where tail is `[sum,a,b,out_f,in_f,nonce_f]` (9 total) for snarkjs-v2/noir-v1 and
  `[sum,a,b]` (6 total) for risc0-v1/ezkl-v1.
- Same arguments → identical commitments across calls; only the nonce differs.
  Cross-call proof replay must yield `proofInvalid`; stale meta nonce yields `nonceMismatch`.
- The demo's printed "checks legend" lives in `packages/client/src/main.ts` and can
  drift from `docs/DEMOS.md` — compare both when output wording matters.
