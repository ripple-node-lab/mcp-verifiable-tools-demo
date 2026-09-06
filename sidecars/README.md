# Sidecars

証明バックエンドのうち TypeScript で閉じないもの（Rust / Python / enclave 等）は、
HTTP sidecar として合成する（`docs/PLAN.md` §2・§5）。MCP サーバーは
`packages/prover-sidecar` の `SidecarProver` / `SidecarVerifier` アダプタ経由で
呼び出し、binding フィールド（`circuitHash` / `inputCommitment` /
`outputCommitment` / `nonce`）が sidecar に改変されていないことを必ず検査する。

## HTTP 契約

| エンドポイント | 内容 |
|---|---|
| `GET /healthz` | `{ "status": "ok", "formats": ["<format>", ...] }` |
| `POST /prove` | 本体 = `ProveInput`（`circuitHash` / `inputCommitment` / `outputCommitment` / `nonce?` / `output` / `verificationKeyUri?`）→ `VerifiableToolsMeta` JSON |
| `POST /verify` | `{ "meta": VerifiableToolsMeta, "expectedCircuitHash": string }` → `{ "ok": boolean, "reason"?: string }` |
| `GET /vk/{circuitHash}` | 検証鍵 PEM（公開鍵を持つ形式のみ） |

## sidecar 一覧

- `sidecars/mock/`（`demo-sig-sidecar-v1`）: 契約のリファレンス実装。
  `demo-sig-v1` と同一の Ed25519 構成を別形式名で提供する。
- `sidecars/nitro/`: `tee-nitro-v1` 用のモック attestation フィクスチャ
  （モック root CA・モック PCR。生成は今のところ in-process の
  `TeeNitroProver` が行う）。
- `sidecars/risc0/`（`risc0-v1`）: RISC Zero zkVM の Rust sidecar
  （`risc0-zkvm` 3.0.6 ピン、`tiny_http` + `serde_json` のみ、tokio 非依存）。
  `add` ゲストは `(a, b): (u32, u32)` を受け取り `a.checked_add(b)` を計算し、
  12 バイト LE の journal（`a || b || sum`）をコミットする。
  `circuitHash` = guest image ID（`sidecars/risc0/image-id.txt` にコミット、
  `RISC0_EXPECT_IMAGE_ID_FILE` で起動時に突合）。
  image ID はゲスト ELF のメモリイメージ由来で、ビルドマシンのパス埋め込みに
  敏感なため、正準値は `sidecars/risc0/Dockerfile`（ピン済み toolchain:
  rust r0.1.97.0 / r0cpp 2024.01.05 / cargo-risczero 3.0.6 を GitHub release
  から直接取得、rzup 非依存）でのビルド結果とする。ホスト上の `cargo build`
  で生成される image ID は一致しない場合がある（compose は
  `RISC0_EXPECT_IMAGE_ID_FILE` で突合して起動時に検出）。
  `RISC0_DEV_MODE` 時は Fake receipt を返す（`/verify` は dev mode でない
  限り Fake を `devModeReceipt` で拒否）。同時 prove 数は
  `MAX_CONCURRENT_PROOFS`（既定 1）で制限し、超過分は 503 `{"error":"busy"}`。
  インフライトの prove のキャンセルは非対応（`SidecarProver` の abort は
  HTTP リクエストを閉じるだけで、r0vm ジョブは完了まで走る）。
  検証は in-process WASM（`sidecars/risc0/wasm-verify` を
  `build-wasm.sh` で wasm32 ビルド → `packages/prover-risc0/wasm`）が既定;
  sidecar 側 `/verify` も契約どおり実装済み。
- `sidecars/ezkl/`（`ezkl-v1`）: Python `ezkl` の ZKML sidecar
  （`python:3.12-slim` + `ezkl==22.0.1` ピン、stdlib `http.server` のみ）。
  回路は ONNX の単一 `Add` ノードで、`input_scale=0` / `param_scale=0`
  （logrows=14）により整数が field element に厳密対応する。入力領域は
  `a, b ∈ [0, 2^24]` に制限される（ONNX FLOAT 入力は 2^24 未満でのみ
  厳密、range-check 分解が 2^28 上限のため `a+b ≤ 2^25` は安全）。
  超過分は 400 `invalidArguments`（サーバー側は -32602）。
  `circuitHash` = sha256(`vk.json`)。起動時に `ezkl.setup` で pk（117 MB）
  を再生成し、生成 vk がコミット済み vk と sha256 一致することを突合する。
  バージョン 22.0.1 固定は必須（`@ezkljs/engine` が 22.0.1 のみで、
  proof/vk/settings 形式が一致しないと検証できない）。`get_srs` は 22.0.1
  で壊れているため perpetual powers-of-tau SRS（`kzg.srs`、2.1 MB）は
  コミット済みを使う（`gen_srs` 出力は engine 検証に失敗する）。
  `MAX_CONCURRENT_PROOFS`（既定 1）で prove をセマフォ制御し、超過分は
  503 `{"error":"busy"}`。インフライト prove のキャンセルは非対応。
  検証は `@ezkljs/engine` の wasm（≈9.8MB、`packages/prover-ezkl`）で
  in-process。
- `sidecars/tlsn/`（`zktls-tlsn-v1`）: TLSNotary の入力プルーベナンス
  sidecar（Phase 3-d）。単一 Rust バイナリが 3 役を務める: loopback HTTPS
  fixture（`test-server.io`、`GET /v1/price/{symbol}` → 決定的な demoPrice
  JSON）、in-process notary（secp256k1、起動時生成または
  `TLSN_NOTARY_KEY_HEX`）、HTTP API（`PORT` 4400）。`POST /attest` が
  `InputAttestation`（`proof` = base64url の bincode Presentation）を返し、
  `POST /verify` が Presentation・notary 鍵・開示された request line /
  response body を検証して `{ok, serverName, data}` を返す。notary 鍵は
  `GET /notary-key`（SPKI PEM）で配布し、クライアントは
  origin-allowlisted registry でピン留めする。in-process の TS 検証は
  `tlsn-core` が bare wasm32 で `getrandom` を要求するため不可で、検証は
  sidecar に委譲する。`MAX_CONCURRENT_ATTESTATIONS`（既定 1）超過は
  503 `{"error":"busy"}`。

## 動かし方

```sh
docker compose --profile sidecar up --build -d --wait
SIDECAR_URL=http://127.0.0.1:4100 npm run test:sidecar
docker compose --profile sidecar down
```

`SIDECAR_URL` を設定した場合、`tests/sidecar.test.ts` の最後で外部 sidecar
への疎通テストが追加で実行される（CI の opt-in ジョブがこれを使う）。

risc0 sidecar（prove ≈20–50 秒、opt-in）:

```sh
docker compose --profile risc0 up --build -d --wait
RISC0_SIDECAR_URL=http://127.0.0.1:4200 node --test tests/dist/risc0-sidecar.test.js
docker compose --profile risc0 down
```

ezkl sidecar（prove ≈2–3 秒、opt-in）:

```sh
docker compose --profile ezkl up --build -d --wait
EZKL_SIDECAR_URL=http://127.0.0.1:4300 node --test tests/dist/ezkl-sidecar.test.js
docker compose --profile ezkl down
```

tlsn sidecar（attest ≈1 秒、opt-in）:

```sh
docker compose --profile tlsn up --build -d --wait
TLSN_SIDECAR_URL=http://127.0.0.1:4400 node --test tests/dist/tlsn-sidecar.test.js
docker compose --profile tlsn down
```
