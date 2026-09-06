# 拡張候補メモ / Extension Candidates

[`docs/PLAN.md`](PLAN.md) は **エンジン非依存** の計画として保ち、特定製品・特定事例に由来する示唆はここに集める。
本ドキュメントの項目は「PLAN のどの節にどう載せられるか」を示すだけで、採否は未決。採用が決まったものは [issue #2](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/2) の提案手順（PLAN §8）を経て PLAN / 仕様へ移し、ここからは削除する。

各候補は次の形式で記録する。

- **出典**: 調査 issue / 外部資料
- **示唆**: PLAN のどの設計方針・Phase・未決事項に関係するか
- **載せ方**: 採用する場合の PLAN / 仕様側の具体的な差分
- **前提 / 未確認**: 採用判断の前に確認が必要なこと

---

## 1. Noir 共通フロントエンド + バックエンド差し替え（World ProveKit を実例に）

- **出典**: [#7 World ProveKit の調査と示唆](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/7)（World Foundation ブログ 2026-09-02、[worldfnd/provekit](https://github.com/worldfnd/provekit)、MIT）
- **示唆**: PLAN §2「本質は証明をどう運ぶか / バックエンドは差し替え可能」の実演材料。Phase 2-b で採用予定の Noir を回路フロントエンドに固定すれば、Barretenberg（UltraHonk）と ProveKit（WHIR + Spartan 変種、transparent、128-bit PQ）を **同じ `.nr` 回路に対する 2 つの `proofFormat`** として並べられる。
- **載せ方**:
  - PLAN §5 Phase 2-b: Noir 回路を `circuits/noir/` に置き、engine 固有物（`vk`, `.pkv`）だけを engine ごとに持つ。
  - PLAN §5 Phase 3: `provekit-v1` を `provekit-cli prepare / prove / verify` の CLI sidecar として追加（`circuitHash` = `.pkv` のハッシュ、`verificationKeyUri` は `.pkv`）。検証は `verifier-server` sidecar か `provekit-verifier` の WASM ビルド（可否は risc0 と同様 Phase 3 冒頭 PoC）。
  - PLAN §5.1: 「transparent / PQ SNARK」行を追加。
  - 仕様: `proofFormats` 例示に `provekit-v1` を追加（`"{engine}-{majorVersion}"` 規則に沿う）。
- **前提 / 未確認**:
  - `provekit-verifier` / FFI の WASM・npm 配布状況（TS in-process 検証の可否）。
  - `v1` ブランチが安定 API、`main` / v2（Goldilocks 移行）で proof / key 形式が変わる → `proofFormat` のメジャーバージョン交渉テストが必要。
  - 証明サイズは 1MB 以内だが `_meta` インライン上限を超え得るため、Phase 2-a (1) の `proofUri` 経路が先に完了していること。

## 2. `proofFormat` ごとの信頼仮定メタデータ（`trustAssumptions`）

- **出典**: #7 §3.5
- **示唆**: 仕様 Security Considerations は鍵配布の完全性を扱うが、trusted setup を持つ形式（Groth16 / `snarkjs-v2`）では setup ceremony の信頼も検証者の前提になる。transparent・PQ・検証 succinct 性は形式ごとに異なり、クライアントが判断できる情報が現状ない。
- **載せ方**: PLAN §7 未決事項「`proofFormat` レジストリ」に併記。capability に `trustAssumptions` 相当（`trustedSetup: bool`, `postQuantum: bool`, `succinctVerification: bool` など）を載せるか、format レジストリ側で表にするかの 2 案。Groth16（setup 有・非 PQ・定数時間検証）と ProveKit（setup 無・PQ・回路サイズ線形検証）が丁度対極なので、両方を実装すれば議論の実例になる。
- **前提 / 未確認**: レジストリの形（仕様 Open Questions）が先に決まる必要がある。

## 3. 双方向 proof（client-attested inputs）

- **出典**: #7 §3.3
- **示唆**: ブラインド呼び出しでは秘密入力の持ち主はクライアント側。「秘密を持つ側がその場で証明する」モデル（ProveKit が端末側証明で示した方向）を取り入れると、**クライアントが自分の入力について証明を付けてサーバーに渡す** 逆向きの proof が自然に考えられる。
- **載せ方**: 仕様 Open Questions に追加。PLAN 側は §4.1 `verifiable-tools/call` のリクエスト `_meta` に `inputProof` 相当を追加する Phase として起こすか、Open Question に留めるか。
- **前提 / 未確認**: 既存の `inputAttestations`（`zktls-tlsn-v1` 等、データプロバイダー側の証明）との役割分担。サーバー側検証器は sidecar 型（PLAN §2 言語方針）でよいか。

## 4. 同じ回路に複数 `proofFormat` を返すサーバー

- **出典**: #7 §3.6（ProveKit v2 ロードマップ: Groth16 バックエンド / 再帰ラップ）
- **示唆**: 「transparent 形式で証明 → Groth16 に畳んでオンチェーン検証」のような経路は、サーバーが同一回路に対して複数形式を提供し、クライアントが `requestedProofFormat` で選ぶユースケースになる。
- **載せ方**: PLAN §4.3 に `requestedProofFormat` の選択テスト（形式ごとに `circuitHash` が `tools/list` の `formats` と一致すること）を追加。risc0 の receipt → Groth16 圧縮（PLAN §5.1）と同じ枝。
- **前提 / 未確認**: なし（現行仕様の範囲内で表現可能）。

---

## 記録済み候補の一覧

| # | 候補 | 関係する PLAN 節 | 状態 |
|---|---|---|---|
| 1 | Noir 共通フロントエンド + `provekit-v1` sidecar | §2, §5 Phase 2-b / 3, §5.1 | 未決 |
| 2 | `trustAssumptions` メタデータ | §7 | 未決 |
| 3 | client-attested inputs | §4.1, 仕様 Open Questions | 未決 |
| 4 | 同一回路の複数 `proofFormat` | §4.3 | 未決 |
