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
- `risc0` / `ezkl` / `tlsn` は Phase 3-b 以降で追加予定。

## 動かし方

```sh
docker compose --profile sidecar up --build -d --wait
SIDECAR_URL=http://127.0.0.1:4100 npm run test:sidecar
docker compose --profile sidecar down
```

`SIDECAR_URL` を設定した場合、`tests/sidecar.test.ts` の最後で外部 sidecar
への疎通テストが追加で実行される（CI の opt-in ジョブがこれを使う）。
