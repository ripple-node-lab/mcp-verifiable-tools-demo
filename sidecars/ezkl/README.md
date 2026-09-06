# sidecars/ezkl — `ezkl-v1` proving sidecar (Phase 3-c)

Python `ezkl` sidecar for the `add` ZKML circuit. Proving happens here;
verification happens in-process in TypeScript via `@ezkljs/engine` 22.0.1
(wasm) — generate in Python, verify in TS.

## Layout

- `server.py` — stdlib `http.server.ThreadingHTTPServer` HTTP host
- `Dockerfile` — `python:3.12-slim` + pinned `ezkl==22.0.1`
- `requirements.txt` — pip pins
- `fixtures/` — committed proof JSON (`a=2, b=40`) + meta for the
  default test suite
- Circuit artifacts (shared with the TS verifier) live at
  `packages/prover-ezkl/circuits/add/`:
  `add.onnx`, `settings.json`, `model.compiled`, `vk.json`, `kzg.srs`,
  `gen.py` (regeneration recipe).

## Version lock (mandatory)

`@ezkljs/engine` ships only **22.0.1**, and the proof/vk/settings formats
must match the Python `ezkl` version exactly (22.3.x/23.x proofs do not
verify under the engine). Everything is pinned to `ezkl==22.0.1`.
`logrows=14` is the smallest setting the engine verifies; below 14 the wasm
verifier fails even though the Python verifier passes.

## Build / run

```sh
docker compose --profile ezkl up --build -d --wait
# or locally: pip install -r requirements.txt && PORT=4300 EZKL_ARTIFACTS_DIR=../packages/prover-ezkl/circuits/add python server.py
```

Environment variables:

- `HOST` (default `0.0.0.0`), `PORT` (default `4300`)
- `EZKL_ARTIFACTS_DIR` (default `/app/artifacts`) — circuit directory
- `MAX_CONCURRENT_PROOFS` (default `1`) — semaphore-gated admission;
  excess `/prove` requests get `503 {"error":"busy"}`. Aborting the HTTP
  request does not cancel an in-flight ezkl job (it runs to completion
  and keeps holding its slot).

At startup the sidecar runs `ezkl.setup` to regenerate `pk.json` (117 MB,
too large to commit), then asserts the produced `vk.json` is sha256-identical
to the committed artifact — a drift exits non-zero (ezkl keygen is
deterministic for the same `model.compiled` + SRS).

## HTTP contract

Same contract as `packages/prover-sidecar/src/contract.ts`:

- `GET /healthz` → `{status:"ok", formats:["ezkl-v1"], circuitHash, maxConcurrentProofs}`
- `POST /prove` → `ProveInput` → `VerifiableToolsMeta`
  (`proof` = base64url of the ezkl proof JSON file;
  `publicInputs = [outputCommitment, inputCommitment, nonce ?? "0x", sum, a, b]`;
  400 `circuitHashMismatch` / `invalidArguments` / `outputMismatch`, 503 `busy`)
- `POST /verify` → `{meta, expectedCircuitHash}` → `{ok, reason?}`
  (reasons: `malformed|circuitHashMismatch|publicInputsMismatch|instancesMismatch|proofInvalid`;
  `instances[0]` must equal `[feltLE(a), feltLE(b), feltLE(sum)]`)
- `GET /vk/{circuitHash}` → `vk.json` (`circuitHash` = `0x` + sha256(vk.json))
- Body limit 1 MiB; `400`/`404` otherwise.

`kzg.srs` (2.1 MB, logrows 14) is the perpetual powers-of-tau SRS. It is
committed because `ezkl.get_srs` is broken in 22.0.1 (fetched with a 23.x
wheel; SRS bytes are version-agnostic). Do not substitute `ezkl.gen_srs`
output — it never verifies under `@ezkljs/engine`.

## Tests

```sh
npm test                                                  # committed fixture via engine wasm
EZKL_SIDECAR_URL=http://127.0.0.1:4300 node --test tests/dist/ezkl-sidecar.test.js
docker compose --profile ezkl down
```
