# デモ構成プラン / Demo Plan

対象仕様: [`docs/spec/verifiable-tools.md`](spec/verifiable-tools.md)（英語 / SEP 提出用）、[`docs/spec/verifiable-tools.ja.md`](spec/verifiable-tools.ja.md)（日本語）
関連 issue: https://github.com/zk-tokyo/advanced-cryptography-2026/issues/94
技術選定の根拠: [#3 ZK / MPC / FHE ライブラリ調査](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/3)、[#4 言語基盤の分析](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/4)、[#6 ACP 2026 で学んだ技術要素](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/6)

## 1. 目的

MCP SEP ガイドラインの「Prototype Requirements」と設計原則「Demonstration over deliberation / Pragmatism over purity」に従い、
`io.modelcontextprotocol/verifiable-tools` 拡張が **MCP 2026-07-28 上で実際に動くこと** をレビュアーが `npm install && npm test` だけで確認できるようにする。

デモが示すこと:

1. `server/discover` での capability 宣言と、リクエスト単位 `_meta` による拡張ネゴシエーション
2. `tools/call` 結果の `_meta["io.modelcontextprotocol/verifiable-tools"]` に証明メタデータを載せ、クライアントがローカル検証できること
3. `io.modelcontextprotocol/tasks` 拡張を使った非同期証明生成（`resultType: "task"` → `tasks/get`）
4. `verifiable-tools/call` によるブラインド実行（暗号化引数 + `inputCommitment`）
5. 仕様の Testing Plan に挙げた否定テスト（不正証明、`circuitHash` 不一致、未宣言 `proofFormat`、不正なブラインド入力、拡張未ネゴシエーション時の無視）

## 2. 設計方針（Pragmatism over purity）

- **プロトコル層を主役にする。** 本拡張の本質は「証明をどう運ぶか」であり、特定の ZK エンジンではない。証明バックエンドは `Prover` / `Verifier` インターフェースの背後に置き、差し替え可能にする。
- **Phase 1 は依存ゼロで動く証明形式を使う。** ezkl / risc0 / snarkjs は環境構築が重く「Be runnable by reviewers」に反するため、Node 標準 `crypto` のみで検証できる 2 形式をまず実装する。
  - `demo-sig-v1`: 「TEE Attestation 相当」のシミュレーション。Prover が `circuitHash || inputCommitment || outputHash` を Ed25519 署名する。`verificationKeyUri` から公開鍵を取得して検証する。
  - `demo-commit-v1`: 「ZK 証明相当」のシミュレーション。`publicInputs = [output, inputCommitment]`、`proof = SHA-256(circuitHash || publicInputs)`。証明としての健全性は無いが、フィールドの流れ（`publicInputs` / `circuitHash` / `verificationKeyUri`）を確認できる。
  - README で **これらは暗号学的な ZK ではないこと** を明記する。
- **Phase 2 で実エンジンを追加する。** `snarkjs-v2`（Groth16, 小さな circom 回路の事前コンパイル済み `wasm` / `zkey` / `vk.json` を同梱）と Noir（UltraHonk）を npm だけで動く実 ZK バックエンドとする。`ezkl-v1` / `risc0-v1` / TEE / zkTLS は Phase 3 で sidecar として合成する（§5）。
- **SDK 依存を避ける。** 公式 SDK の 2026-07-28 対応状況に左右されないよう、JSON-RPC 2.0 + Streamable HTTP（POST のみ）を薄く自前実装する。将来 `typescript-sdk` の Extension API に載せ替えられるよう、プロトコル処理は `packages/protocol` に隔離する。
- **言語方針（#4 の結論）: プロトコル層・クライアント検証層は TypeScript、証明バックエンドは engine ごとに最適な言語をアダプタ経由で合成する。** 判断の軸は上記「本質は証明をどう運ぶか」と同じで、言語の境界も同じ場所に置く。
  - `packages/protocol` / `server` / `client` / `verifier` は TS を維持する。MCP の正典スキーマと Phase 4 の移植先（`typescript-sdk`）が TS であり、検証器は IDE / エージェントホスト（多くが TS）へ npm / WASM で配布できる必要があるため。
  - `Prover` / `Verifier` の実装は 2 種類のアダプタに分ける。**in-process**（TS / WASM: `snarkjs`, Noir `@noir-lang/noir_js` + `@aztec/bb.js`, `@ezkljs/engine` の検証、`hpke-js`）と **sidecar**（Rust / Python / enclave を Docker 化し CLI / HTTP で呼ぶ: risc0 host, ezkl prover, Nitro enclave, TLSNotary prover）。engine の言語はアダプタの背後に隠す。
  - `npm test` の既定は in-process 形式のみで常に通す。sidecar 形式は `docker compose --profile sidecar` の opt-in とし、CI では別ジョブにする（「Be runnable by reviewers」を守る）。
  - 採らない方向: Rust / Go / Python への全面移行（SEP レビュアーの再現性と Phase 4 の移植コストを悪化させる）、全 engine の WASM 化による in-process 押し込み（risc0 / ezkl の prover は WASM では実用速度にならない。WASM 化は検証器に限定する）。
- **「正しい計算」だけでなく「何に束縛された証明か」を仕様で固定する。** 仕様改訂（下記 §2.1）で `outputCommitment` / `nonce` / `tools/list` 記述子 / `inputAttestations` / 遅延証明を導入した。デモはこれらを Phase 2 の冒頭で実装し、否定テストで「本物の証明 + 別の出力」「古い証明の再送」「塩なしコミットメントの総当たり」が弾かれることを示す。

### 2.1 仕様改訂（2026-09）の要点と根拠

#94 のコメント（費用負担はサーバー側想定、都度検証かスポット検証かはユースケース次第、発展として zkTLS / FHE、評価軸として証明時間・サイズ・計算コスト）と #3 / #4 / #6 の調査結果を踏まえ、仕様に以下を追加した。

| 追加項目 | 何を解決するか | 根拠となった議論 |
|---|---|---|
| Motivation「認可では埋まらない信頼のギャップ」+ ユースケース A〜F | 「誰がアクセスできるか」と「返ってきた値が正しいか」の差を、第三者サーバー・サプライチェーン侵害・不可逆アクション・事後説明責任の 4 条件で言語化し、A2A ツール市場 / トレーディング / 規制下の私的データ / 認証済みモデル推論 / 多段エージェント / 自律的セキュリティ応答（Proof-of-Exploit）の 6 シナリオで具体化 | #94 概要、#6 Week 1（PoE × Circuit-Breaker）・Week 2（ZK/FHE/MPC/TEE 比較） |
| 「保証すること / しないこと」表 | 入力の真正性・関数の妥当性・可用性は本拡張の範囲外であることを明示（誤解による過信を防ぐ） | #6 Week 2（MPC は入力の正しさを保証しない → ZK / コミットメントで補う）、Week 5（FHE 単体では正しさを保証しない） |
| `outputCommitment` / `nonce` / Result binding 節 | 本物の証明を別の `content` に貼り替える攻撃、古い証明の再送攻撃を防ぐ。`publicInputs[0..2]` の順序を固定し engine 間の相互運用性を上げる | 仕様 Open Question「`publicInputs` の標準エンコーディング」、Phase 1 実装レビュー |
| 塩付き `inputCommitment`（JCS RFC 8785） | 現行デモの `SHA-256(canonical JSON(args))` は hiding でなく、低エントロピー引数（口座番号・可否フラグ）が総当たりで復元できる。ブラインド呼び出しでは塩を暗号化ペイロードに含める | Phase 1 実装レビュー、#6 Week 3（コミットメントスキーム） |
| `tools/list` `_meta` の記述子（`circuitHash`, `proofPolicy`, ...） | クライアントが tool → `circuitHash` を得る経路を定義（§7 未決事項の解消）。ただし記述子は hint であり TOFU / 帯域外レジストリでピン留めする | §7 未決事項 |
| `inputAttestations`（`zktls-tlsn-v1`, `oracle-sig-v1`, `mcp-verifiable-v1`） | 「データプロバイダーへの依拠」を扱う。zkTLS で外部 API の出力を、ネストした MCP 結果で上流サーバーの証明を、それぞれ主証明の public input に連結する | #94 コメント「データプロバイダーの依拠: zkTLS」、#3 §2（mpz = TLSNotary 基盤） |
| 遅延証明（`resultId`, `verifiable-tools/prove`, `proofPolicy: always / onDemand / sampled`, `resultTtlMs`） | 「都度でなくスポットで検証したい」「証明コストを誰が負担するか」を、プロトコルに固定せず tool 単位で選べるようにする | #94 コメント 3〜4 |
| `encryptionScheme` の固定（`hpke-v1` = RFC 9180 DHKEM(X25519)+HKDF-SHA256+AES-128-GCM、`fhe-tfhe-v1` は予約）、`blindPublicKeys` の attestation 束縛、出力側漏洩と `replyPublicKey` | 現行 `x25519-aesgcm-demo-v1` から標準 HPKE へ。FHE は「機密性は得られるが正しさは vFHE がないと証明できない」として予約のみ | #3 §3（node-seal / TFHE-rs）、#4 §4-5（`hpke-js`）、#6 Week 5（PBS, vFHE）、Week 2（output leakage） |
| TEE attestation 形式の検証手順（chain / measurement / user-data への鍵束縛 / freshness） | `teeAttestation` を「不透明な文字列」から検証可能な契約にする | #4 §2（Nitro は TS で検証可、SGX DCAP は sidecar） |
| Rationale のトレードオフ表、Performance の計測義務 | 証明時間・サイズ・検証時間・検証器の依存フットプリントを format 定義ごとに報告させる | #94 コメント「証明生成時間、証明サイズ、計算速度、計算コスト、トレードオフ」 |
| Security: replay / output substitution / hiding / provenance / descriptor trust / randomness reuse / revocation | 否定テスト（§4.3）と 1 対 1 に対応させる | #6 Week 2（Beaver triple 再利用）、Week 3（nonce 再利用による鍵復元） |

## 3. リポジトリ構成

```text
mcp-verifiable-tools-demo/
├── README.md                     # セットアップ手順、拡張識別子、対応 proofFormat、免責
├── docs/
│   ├── PLAN.md                   # 本ドキュメント
│   └── spec/
│       ├── verifiable-tools.md      # SEP 草案（英語）
│       └── verifiable-tools.ja.md   # SEP 草案（日本語）
├── package.json                  # npm workspaces
├── tsconfig.base.json
├── packages/
│   ├── protocol/                 # 拡張の型・定数・_meta ヘルパー（SDK 非依存）
│   │   └── src/
│   │       ├── constants.ts      # EXTENSION_ID, TASKS_EXTENSION_ID, PROTOCOL_VERSION, META キー
│   │       ├── types.ts          # VerifiableToolsCapability, VerifiableToolsMeta, VerifiableCallParams ...
│   │       ├── meta.ts           # clientCapabilities 生成 / 抽出、ネゴシエーション判定（proofFormats の交差）
│   │       └── index.ts
│   ├── prover/                   # 証明バックエンド（サーバー側）
│   │   └── src/
│   │       ├── prover.ts         # interface Prover { format; prove(input) }
│   │       ├── demo-sig.ts       # demo-sig-v1（Ed25519）
│   │       ├── demo-commit.ts    # demo-commit-v1（SHA-256）
│   │       └── index.ts
│   ├── verifier/                 # 証明検証（クライアント側）
│   │   └── src/
│   │       ├── verifier.ts       # interface Verifier { format; verify(meta, ctx) }
│   │       ├── demo-sig.ts
│   │       ├── demo-commit.ts
│   │       ├── registry.ts       # verificationKeyUri → 公開鍵の取得と circuitHash ごとのピン留め
│   │       └── index.ts
│   ├── server/                   # MCP 2026-07-28 Streamable HTTP サーバー
│   │   └── src/
│   │       ├── http.ts           # POST /mcp, MCP-Protocol-Version / Mcp-Method / Mcp-Name 検査
│   │       ├── discover.ts       # server/discover
│   │       ├── tools.ts          # tools/list, tools/call（同期 / タスク）
│   │       ├── tasks.ts          # tasks/get, tasks/cancel（インメモリタスクストア）
│   │       ├── blind.ts          # verifiable-tools/call（復号 → 実行 → 証明）
│   │       ├── tools/
│   │       │   ├── add.ts        # add(a, b): 同期証明
│   │       │   ├── riskScore.ts  # riskScore(symbol): 遅延付き非同期証明（tasks）
│   │       │   └── creditCheck.ts# privateCreditCheck: ブラインド専用
│   │       └── main.ts           # `npm run server`
│   └── client/                   # 検証クライアント
│       └── src/
│           ├── client.ts         # discover → capability 交差 → tools/call → verify
│           ├── tasks.ts          # pollIntervalMs に従う tasks/get ポーリング
│           ├── blind.ts          # 引数暗号化 + inputCommitment 生成 → verifiable-tools/call
│           └── main.ts           # `npm run demo` で 3 シナリオを順に実行
├── examples/                     # 仕様書と同じ JSON メッセージのサンプル（fixture としてテストでも使用）
│   ├── discover.json
│   ├── tools-call.request.json
│   ├── tools-call.result.json
│   ├── tools-call.task.json
│   ├── tasks-get.request.json
│   └── verifiable-tools-call.request.json
├── tests/                        # node:test（統合テスト）
│   ├── negotiation.test.ts
│   ├── sync-proof.test.ts
│   ├── async-tasks.test.ts
│   ├── blind-call.test.ts
│   └── negative.test.ts
└── .github/workflows/ci.yml      # npm ci && npm run build && npm test
```

## 4. 各コンポーネントの仕様

### 4.1 サーバー（`packages/server`）

- `POST /mcp` のみ。`Content-Type: application/json`。
- 必須ヘッダー検査: `MCP-Protocol-Version: 2026-07-28`、`Mcp-Method` が JSON-RPC の `method` と一致、`tools/call` では `Mcp-Name` が `params.name` と一致。不一致は JSON-RPC `-32600 Invalid Request`。
- 各リクエストの `params._meta["io.modelcontextprotocol/clientCapabilities"]` から拡張宣言を読む（ステートレス。セッション ID は使わない）。
- `server/discover` 応答は仕様書 §5 の例と同一形式（`proofFormats: ["demo-sig-v1", "demo-commit-v1"]`, `blindExecution: true`, `io.modelcontextprotocol/tasks: {}`）。
- `tools/call`:
  - クライアントが本拡張を宣言していなければ **通常の `CallToolResult` のみ**（`_meta` に拡張キーを付けない）。
  - 宣言していれば `proofFormats` の交差から 1 形式を選ぶ（`_meta["io.modelcontextprotocol/verifiable-tools"].requestedProofFormat` を優先）。交差が空で `requireProof: true` なら `-32602` 相当のエラー、そうでなければ証明なしで返す。
  - `riskScore` はクライアントが `io.modelcontextprotocol/tasks` を宣言している場合のみ `resultType: "task"` を返す（未宣言なら同期で待って返す）。
- `tasks/get` / `tasks/cancel`: SEP-2663 の `Task` 形状（`taskId`, `status`, `createdAt`, `lastUpdatedAt`, `ttlMs`, `pollIntervalMs`）。完了時は `result` に `CallToolResult` + 拡張 `_meta` を含める。
- `verifiable-tools/call`: `encryptionScheme: "x25519-aesgcm-demo-v1"`（HPKE の簡易代替。README で明記。Phase 2-a で `hpke-v1` + 塩付きコミットメントに置換）。サーバーの X25519 公開鍵は `server/discover` の拡張 capability に `blindPublicKey`（単数、デモ用フィールド）として載せる。改訂仕様の `blindPublicKeys`（scheme → 鍵のマップ）への移行は Phase 2-a。復号後に `SHA-256(canonical JSON(args))` が `inputCommitment` と一致することを確認、不一致は `-32602`。応答 `_meta` には `inputCommitment` を含める。
- `GET /vk/{circuitHash}`: `verificationKeyUri` の実体。`demo-sig-v1` の Ed25519 公開鍵（PEM）を返す。

### 4.2 クライアント（`packages/client`）

1. `server/discover` → サーバーの `proofFormats` と自分の対応形式を交差。
2. `tools/call add` → 同期結果 → `verifier.verify()`。
3. `tools/call riskScore` → `resultType: "task"` → `pollIntervalMs` 間隔で `tasks/get` → `completed` → 検証。
4. `verifiable-tools/call privateCreditCheck` → 暗号化 + コミットメント → 応答の `inputCommitment` が自分の計算値と一致し、署名が有効であることを確認。
5. 検証失敗時は結果を使用せず非ゼロ終了（仕様書「A client MUST NOT act on a tool result whose proof fails verification」）。

### 4.3 テスト（`tests/`、`node --test`）

| ファイル | 検証内容 |
|---|---|
| `negotiation.test.ts` | 拡張未宣言 → `_meta` に拡張キーなし / 宣言 → あり / 交差空 + `requireProof` → エラー |
| `sync-proof.test.ts` | `add` の証明が両形式で検証成功、`publicInputs[0]` が `content[0].text` と一致 |
| `async-tasks.test.ts` | `tasks` 未宣言 → 同期完了 / 宣言 → `resultType: "task"` → ポーリングで完了し検証成功 |
| `blind-call.test.ts` | 正常系、`Mcp-Name` 無しで受理されること、サーバーログに平文が出ないこと |
| `negative.test.ts` | 改ざん `proof`、`circuitHash` 不一致、未宣言 `proofFormat`、`inputCommitment` 不一致、`Mcp-Method` 不一致 |
| `binding.test.ts`（Phase 2-a） | 本物の証明 + 改ざん `content` → `outputCommitment` 不一致で拒否 / 前回の証明を再送 → `nonce` 不一致で拒否 / 塩なし・塩違いのブラインドコミットメント → 拒否 |
| `descriptor.test.ts`（Phase 2-a） | `tools/list` の `circuitHash` がピン留め値と異なる → 黙って受理せずエラーとして表面化 |
| `deferred-proof.test.ts`（Phase 2-a） | `proofPolicy: onDemand` の tool → `resultId` のみ返る → `verifiable-tools/prove` で `content` がバイト一致し証明が検証成功 / `resultTtlMs` 経過後は `resultExpired` |
| `provenance.test.ts`（Phase 3） | `requireInputProvenance: true` で `inputAttestations` 欠落・不正 → 主証明が有効でも拒否 |
| `randomness.test.ts`（Phase 2-b 以降） | 証明ごとに乱数が再利用されていないこと（Week 3 nonce 再利用 / Week 2 Beaver triple 再利用の教訓） |

## 5. 実装フェーズ

| Phase | 内容 | 成果物 |
|---|---|---|
| 1（完了） | 上記構成の雛形 + `demo-sig-v1` / `demo-commit-v1` + 3 シナリオ + テスト + CI | `npm run demo` / `npm test` が通る |
| 2-a 仕様改訂の追従（Phase 2 の先行タスク） | (1) `Prover.prove(input, { signal }): Promise<ProofArtifact>` / `Verifier.verify(...): Promise<...>` へ非同期化し `AbortSignal` を `tasks/cancel` に接続、`proofUri` 経路を `packages/server` に追加（#4 §4-1）。(2) `outputCommitment` / `nonce` / 塩付き `inputCommitment`（JCS）/ `tools/list` 記述子 / `resultId` + `verifiable-tools/prove` / `proofPolicy` を protocol・server・client に実装、`server/discover` の応答に `blindEncryptionSchemes` / `blindPublicKeys` / `resultTtlMs` を追加（Phase 1 の応答は改訂前仕様のまま）。(3) `x25519-aesgcm-demo-v1` を `hpke-v1`（`hpke-js`）へ置換。(4) §4.3 の binding / deferred / descriptor 否定テストを追加 | 既存 2 形式のまま、改訂仕様の全フィールドが `npm test` で検証される |
| 2-b 実 ZK（in-process） | `snarkjs-v2`（Groth16、circom `add` 回路を事前コンパイルして `wasm` / `zkey` / `vk.json` を同梱。Week 1 の under-constrained 攻撃をレビュー観点にする）。第 2 形式として Noir（`@noir-lang/noir_js` + `@aztec/bb.js`, UltraHonk, トラステッドセットアップ不要）を採用し、同じ `add` を 2 系統で示す。両者は別 workspace（`packages/prover-snarkjs`, `packages/prover-noir`）に隔離するが `npm test` 既定に含める。各形式の proving 時間・メモリ・証明サイズ・検証時間・検証器依存サイズを `docs/BENCHMARKS.md` に記録 | 実 ZK 証明が 2 形式動き、計測値が公開される |
| 3 sidecar 合成 | `packages/prover-sidecar`（TS アダプタ）+ `sidecars/{risc0,ezkl,nitro,tlsn}/Dockerfile`。`risc0-v1`: Rust host を Docker 化し `prove(circuitHash, witness) -> receipt` を HTTP で提供、検証は Rust sidecar `/verify` か `risc0-zkvm` verifier の WASM ビルド（可否を Phase 3 冒頭で PoC）。`ezkl-v1`: 生成は Python `ezkl` sidecar、検証は `@ezkljs/engine`（WASM）で TS 側（「生成は他言語、検証は TS」の非対称性を体現）。`tee-nitro-v1`: COSE_Sign1 attestation の検証（chain / PCR / user-data 鍵束縛 / nonce）を TS で実装し、ローカル CI ではモック attestation でフローを通す。`zktls-tlsn-v1`: `riskScore` の価格取得に TLSNotary sidecar を挟み `inputAttestations` を出す。CI は `npm test`（必須）と `docker compose --profile sidecar`（opt-in ジョブ）に分割 | SEP 本文 Reference Implementation 節の Phase 3 項目を埋める |
| 4 SDK 移植 | `modelcontextprotocol/typescript-sdk` の Extension API へ `packages/protocol` を移植（正典）。Python SDK 版は `ezkl-v1` サーバー側の第 2 参照実装として位置づける（#4 §4-4） | SDK フォーク/ブランチ |
| 発展（任意） | `fhe-tfhe-v1`（`node-seal` または TFHE-rs WASM でクライアント暗号化 → サーバー準同型評価。正しさは vFHE 待ちのため機密性のみのデモ）、MPC / co-SNARK prover（複数データプロバイダーの入力を秘密分散したまま証明。MP-SPDZ / MPyC / mpz sidecar） | Open Questions の材料 |
| SEP 提出 | `docs/spec/verifiable-tools.md` の Reference Implementation 節に SDK 実装と計測結果へのリンクを追記し、`modelcontextprotocol/modelcontextprotocol` に SEP PR を提出（事前に MCP org の `experimental-ext-*` で incubation するかを判断） | SEP PR |

### 5.1 ライブラリ選定（#3 / #4 の結論）

| 役割 | 第一候補 | 代替 | 組み込み形態 | 備考 |
|---|---|---|---|---|
| 小回路 SNARK | `snarkjs` + Circom | Noir（`@noir-lang/noir_js` + `@aztec/bb.js`） | in-process（npm / WASM） | Groth16 は回路ごとのセットアップが必要。Noir は universal / setup 不要で TS 統合が公式 |
| zkVM | RISC Zero（`risc0-v1`） | SP1 | sidecar（Rust, Docker） | TS 公式バインディング無し。receipt → Groth16 圧縮で証明サイズを ~0.2 KB に |
| ZKML | ezkl（`ezkl-v1`） | — | 生成 sidecar（Python / CLI）、検証 in-process（`@ezkljs/engine`） | Scenario D（認証済みモデル推論）向け |
| TEE | AWS Nitro Enclaves（`tee-nitro-v1`） | Intel SGX DCAP（`tee-sgx-dcap-v1`, 検証は sidecar）, AMD SEV-SNP | 生成 enclave、検証 in-process（`cbor` + `@peculiar/x509`） | 検証は TS で閉じる。生成は enclave 側 SDK |
| 引数暗号化 | `hpke-js`（RFC 9180） | — | in-process | `x25519-aesgcm-demo-v1` を置換 |
| 入力 provenance | TLSNotary（`zktls-tlsn-v1`, 基盤は PSE `mpz`） | 署名付きオラクル（`oracle-sig-v1`） | sidecar | 「データプロバイダーへの依拠」 |
| FHE（発展） | `node-seal`（SEAL WASM, BFV/CKKS） | TFHE-rs WASM / Concrete（Python） | in-process（暗号化）+ sidecar（評価） | vFHE 不在のため機密性デモに限定 |
| MPC（発展） | MP-SPDZ | MPyC（試作）, mpz / swanky（Rust） | sidecar | JS 製汎用 MPC は保守停滞（JIFF）のため不採用 |
| 正規化 / ハッシュ | JCS（RFC 8785）+ SHA-256 | — | in-process（Node `crypto`） | 現行 `canonicalJson` を JCS 準拠に置換 |

選定時の共通チェック（#3 §5）: ライセンス（TFHE-rs / Concrete は BSD-3-Clear）、第三者監査、直近 12 か月の保守、WASM 対応、on-chain verifier 出力、トラステッドセットアップの要否。

## 6. 仕様との対応表

| 仕様書節 | デモでの実装箇所 |
|---|---|
| Extension identifier / Capability object | `packages/protocol/src/constants.ts`, `packages/server/src/discover.ts` |
| Request metadata / HTTP headers | `packages/protocol/src/meta.ts`, `packages/server/src/http.ts` |
| Verifiable tool result (`_meta` フィールド) | `packages/protocol/src/types.ts`, `packages/prover/*` |
| Asynchronous proof generation via Tasks | `packages/server/src/tasks.ts`, `packages/client/src/tasks.ts` |
| Blind / committed-input tool calls | `packages/server/src/blind.ts`, `packages/client/src/blind.ts` |
| Verification flow | `packages/verifier/*`, `packages/client/src/client.ts` |
| Security Implications（VK ピン留め、形式の交差） | `packages/verifier/src/registry.ts`, `packages/protocol/src/meta.ts` |
| Result binding（`outputCommitment` / `nonce` / 塩付きコミットメント） | Phase 2-a: `packages/protocol/src/types.ts`, `packages/prover/*`, `packages/verifier/*`, `tests/binding.test.ts` |
| Tool descriptor metadata | Phase 2-a: `packages/server/src/tools.ts`（`tools/list` `_meta`）, `packages/verifier/src/registry.ts` |
| Deferred proofs（`verifiable-tools/prove`） | Phase 2-a: `packages/server/src/prove.ts`（新規）, `tests/deferred-proof.test.ts` |
| Input provenance（`inputAttestations`） | Phase 3: `sidecars/tlsn`, `packages/verifier/src/provenance.ts`（新規） |
| TEE attestation formats | Phase 3: `sidecars/nitro`, `packages/verifier/src/tee-nitro.ts`（新規） |
| Rationale トレードオフ表 / Performance 計測義務 | Phase 2-b 以降: `docs/BENCHMARKS.md` |
| Testing Plan | `tests/*` |

## 7. 未決事項

- `proofFormat` 文字列のレジストリをどう扱うか（仕様書 Open Questions と同じ）。
- 公式化前の拡張識別子: 現状は `io.modelcontextprotocol/verifiable-tools` を使用しているが、SEP 受諾前の第三者実装は vendor prefix（例 `com.ripple-node-lab/verifiable-tools`）を使うべき。受諾されなかった場合は識別子を切り替える。
- `tools/list` 記述子は hint に留まるため、tool→`circuitHash` の帯域外レジストリ（署名付きマニフェスト / transparency log）の具体形。
- `verifiable-tools/prove` の `resultTtlMs` 中にサーバーが保持すべき状態（入力そのものか、コミットメントと出力のみか）とブラインド呼び出しとの両立。
- `risc0-zkvm` verifier の WASM ビルド可否、`@ezkljs/engine` の対応モデル規模、Nitro attestation 検証の TS 実装コスト（Phase 3 冒頭の PoC で確認）。
- vFHE（`fhe-tfhe-v1` で正しさも保証する構成）と MPC / co-SNARK prover を Phase として起こすか、Open Question に留めるか。
- Scenario A（ツール市場）向けに capability へ価格 / コストヒントを載せるか（経済的インセンティブの扱い、#94 コメント 3）。
- SEP 受諾前に MCP org 内の experimental extension（`experimental-ext-*`、WG/IG 紐付け必須）として incubation を行うか。

解消済み（2026-09 仕様改訂）: `blindPublicKeys` / `blindEncryptionSchemes` を capability に正式追加して normative 化、Phase 4 の SDK 移植先は TS を正典・Python を ezkl 補完に決定、`tasks/cancel` は producer を停止すべきと仕様に明記（実装は Phase 2-a）。

## 8. 拡張プラン提出手順

拡張プランの提出は [issue #2](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/2) の手順に従い、`.github/ISSUE_TEMPLATE/extension-proposal.md` のテンプレートを使用する。

- Step 0: §2 設計方針との整合チェックを行い、逸脱する場合は理由を記載する。
- Step 1: `proposal` ラベルでテンプレートを使い、Discussion issue（1 提案 = 1 issue）を作成する。
- Step 2: 合意形成後、`accepted` / `needs-revision` / `rejected` ラベルで状態を更新する。
- Step 3: PR に `Closes #<proposal issue>` を含め、`docs/PLAN.md` と仕様（英日）を同期する。
- Step 4: Phase 完了時に成果物を確認し、SEP-2133 対応（公式 SDK 参照実装・SEP 提出）へ進む。
