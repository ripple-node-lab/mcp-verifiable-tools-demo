# SEP-{NUMBER}: Blind (Committed-Input) Tool Calls — companion to Verifiable Tool Results

> **Note**: This draft is a **companion proposal** to [`verifiable-tools.md`](./verifiable-tools.md) (the *base extension*). It is intended as a second, separately reviewed **Extensions Track** proposal for MCP `2026-07-28`. It does not change the base extension's result-binding rules; it only defines *how a non-empty salt and encrypted arguments are carried* so that the base extension's `inputCommitment` becomes hiding.

- **Status**: Draft (depends on the base extension)
- **Type**: Extensions Track
- **Created**: 2026-09-22 (split out of the base draft, which carried this material from 2026-08-11)
- **Author(s)**: (your name / @your-github-username)
- **Sponsor**: None (seeking sponsor)
- **PR**: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/{NUMBER}

## Abstract

The base extension lets a client check that a pinned program `f` was executed on committed inputs `X` and returned exactly the `content` it received (*execution integrity*). It says nothing about *who sees `X`*: for plain `tools/call` the arguments are in the request and the server operator reads them.

This companion adds a new method, `verifiable-tools/call`, that lets a client call a tool **without revealing plaintext arguments to the MCP server process**. Arguments and a 32-byte salt are encrypted to a key that lives inside the proving environment (a TEE, or the machine running a ZK prover), the client sends the base extension's `inputCommitment` alongside, and the server proves execution over the decrypted arguments exactly as in the base extension. Optionally, the reply is encrypted back to the client.

The companion **reuses the base extension's commitment construction unchanged**: `inputCommitment = "0x" || hex(SHA-256(salt || JCS(arguments)))`, with the salt now being exactly 32 random bytes instead of empty. Every verifier written against the base extension verifies a blind result by supplying the salt it generated.

## Motivation

Some tool inputs must not be disclosed to the tool operator beyond what the computation needs: an applicant's financial record sent to a scoring service, a not-yet-disclosed exploit input sent to an exploitability oracle, a counterparty's position sent to a risk engine. At the same time the caller (or a later auditor) needs the base extension's guarantee that the *approved* program, not a variant, was applied.

The base extension alone cannot serve this case: its `inputCommitment` is an *unsalted* hash and the arguments travel in the clear. The companion supplies the missing pieces — confidential transport of the arguments and a hiding commitment — while leaving the proof, the output binding, the nonce, deferred proofs and the Tasks integration exactly as the base extension defines them.

### Scenario: regulated decisions on private data

A bank's agent calls `privateCreditCheck` on a scoring service. Two obligations conflict: the applicant's data must not be revealed to the service operator beyond what the computation needs, and the regulator must later be able to confirm that the *approved* scoring model, not a discriminatory variant, was applied. Blind execution handles the first; the base extension's proof bound to the model's `circuitHash` handles the second. The proof, not a log entry, becomes the audit artifact.

### What this companion adds — and does not

| Property | Guaranteed by | Notes |
|---|---|---|
| The plaintext of `X` is hidden from the MCP server process | `verifiable-tools/call` + `hpke-v1` | The proving environment (TEE, or the prover host) still sees `X`; only the reserved `fhe-tfhe-v1` scheme hides it from everyone but the client. |
| `inputCommitment` reveals nothing about low-entropy `X` | 32-byte random salt inside `encryptedArguments` | Base-extension commitments are unsalted and therefore *not* hiding. |
| The plaintext of `Y` is hidden from the server process | Encrypted replies (`replyPublicKey`) | Optional. Without it, a low-cardinality output (`approved`/`declined`) leaks to the operator. |
| `Y = f(X)`, output binding, replay protection, deferred proofs | **Base extension**, unchanged | This companion adds no new evidence type and no new verification step other than decrypting the reply. |
| Side-channel-free proving | **Not guaranteed** | Proving time and memory can leak information about `X`. |

## Specification

### Relationship to the base extension

- This companion REQUIRES the base extension. A party MUST NOT advertise this companion without also advertising `io.github.ripple-node-lab/verifiable-tools`.
- The base extension's §Result binding is normative here. This companion only exercises the branch it reserves for non-empty salts: *"a non-empty salt is exactly 32 bytes from a cryptographically secure random source and is carried inside an encrypted request envelope defined by a companion extension"*. The layout of `publicInputs` (`[outputCommitment, inputCommitment, nonce, ...format-specific]`), `outputCommitment`, `nonce`, `proofFormat` negotiation, `circuitHash` pinning, `verifiable-tools/prove`, and the Tasks integration are unchanged.
- The base extension reserves the names used here (`blindExecution`, `blindEncryptionSchemes`, `blindPublicKeys`, `replyPublicKey`, `encryptedContent`, and the tool-descriptor field `blind`) so that they cannot be redefined with different meaning.

### Extension identifier

```text
io.github.ripple-node-lab/verifiable-tools-blind
```

The companion has its own identifier rather than being a capability member of the base extension, so that "negotiate one extension" never silently means "get two", and so that a reviewer or implementer can adopt the base extension without reading this document. If accepted into MCP, the identifier — and the HPKE `info` labels derived from it — would move to `io.modelcontextprotocol/verifiable-tools-blind`.

> **Reference implementation note.** The demo at <https://github.com/ripple-node-lab/mcp-verifiable-tools-demo> implements everything in this document, but (as of this split) still advertises the blind capability members and dispatches `verifiable-tools/call` under the *base* identifier, and derives HPKE `info` labels from it. Moving the demo to the companion identifier is tracked in [`docs/PLAN.md`](../PLAN.md).

### Capability object

Advertised under `extensions[<companion identifier>]`:

| Field | Type | Description |
|---|---|---|
| `blindExecution` | `boolean` | Whether the party supports blind / committed-input tool calls. |
| `blindEncryptionSchemes` | `string[]` | For servers: `encryptionScheme` values accepted by `verifiable-tools/call`, e.g. `["hpke-v1"]`. REQUIRED when `blindExecution: true` on a server. |
| `blindPublicKeys` | `object` | For servers: map from `encryptionScheme` value to that scheme's base64url public key, for every listed scheme that encrypts to a server-held recipient key (`hpke-v1`: raw X25519). REQUIRED when `blindExecution: true` and at least one such scheme is listed. Client-keyed schemes (the reserved `fhe-tfhe-v1`, where the client holds the decryption key) MUST NOT have an entry. |

Example `server/discover` fragment (both extensions advertised):

```json
"extensions": {
  "io.github.ripple-node-lab/verifiable-tools": {
    "proofFormats": ["tee-sgx-dcap-v1"],
    "resultTtlMs": 86400000
  },
  "io.github.ripple-node-lab/verifiable-tools-blind": {
    "blindExecution": true,
    "blindEncryptionSchemes": ["hpke-v1"],
    "blindPublicKeys": { "hpke-v1": "<base64url X25519 public key>" }
  },
  "io.modelcontextprotocol/tasks": {}
}
```

### Request metadata

In addition to the base extension's request options (`requestedProofFormat`, `nonce`), a blind call MAY carry under `_meta[<companion identifier>]`:

| Request option | Type | Description |
|---|---|---|
| `replyPublicKey` | `string` | base64url raw X25519 public key to which the server encrypts `content` under `hpke-v1` when the tool's output must also stay confidential. See §Encrypted replies. |

### Tool descriptor metadata

Servers SHOULD mark tools that accept `verifiable-tools/call` in `tools/list` under `_meta[<companion identifier>]`:

| Field | Type | Description |
|---|---|---|
| `blind` | `boolean` | Whether the tool accepts `verifiable-tools/call`. |

The base extension's descriptor fields (`circuitHash`, `proofFormats`, `proofPolicy`, `verificationKeyUri`, `formats`) apply unchanged to blind calls.

### Input binding with a non-empty salt

The base extension defines `inputCommitment = "0x" || hex(SHA-256(salt || JCS(arguments)))` and requires the salt to be empty for plain `tools/call`. For `verifiable-tools/call`:

- The client MUST generate `salt` as exactly 32 bytes from a cryptographically secure random source, fresh per call.
- The client MUST compute `inputCommitment` with that salt and MUST send it in the clear as a request parameter (below).
- The salt MUST be carried only inside `encryptedArguments`; no plaintext request field carries it.
- The server MUST recompute `inputCommitment` from the decrypted `salt` and `arguments` and MUST reject the call with `-32602` on mismatch, or when the decrypted salt is not exactly 32 bytes.
- The client verifies the result by supplying the same salt to the base extension's §Verification flow step (3); nothing else in the verifier changes.

### `verifiable-tools/call`

```text
verifiable-tools/call
```

Parameters:

| Field | Type | Required | Description |
|---|---|---|---|
| `tool` | `string` | Yes | The name of the tool to invoke. |
| `inputCommitment` | `string` | Yes | The base extension's commitment over `salt || JCS(arguments)`. |
| `encryptionScheme` | `string` | Yes | Identifier for the encryption/key-agreement scheme. See the table below. |
| `encryptedArguments` | `string` | Yes | base64url string; the plaintext is the JCS encoding of `{ "salt": "0x...", "arguments": { ... } }`. |
| `proofFormat` | `string` | No | Preferred proof format. |

Request options (`nonce`, `replyPublicKey`) live under `params._meta` as in the base extension. `verifiable-tools/call` is an ordinary JSON-RPC request on the same MCP session and transport as `tools/call`; servers that have not negotiated this companion MUST answer `-32601`.

Defined `encryptionScheme` values:

| Value | Meaning | Who sees plaintext |
|---|---|---|
| `hpke-v1` | [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180) HPKE, base mode, `DHKEM(X25519, HKDF-SHA256)` / `HKDF-SHA256` / `AES-128-GCM`. `encryptedArguments` = `base64url(enc \|\| ciphertext)` (unpadded, RFC 4648 §5); `enc` is the 32-byte X25519 encapsulated key, so the receiver splits the first 32 decoded bytes. AAD = `JCS({tool, inputCommitment, encryptionScheme})`. `info` = UTF-8 `"<companion identifier>/hpke-v1/args"`. | The proving environment (TEE or the machine running the prover). The MCP server process outside it MUST NOT. |
| `fhe-tfhe-v1` | Arguments encrypted under a client-held TFHE key; the tool is evaluated homomorphically and `content` is returned encrypted. Reserved: requires verifiable FHE to also obtain an execution-integrity proof, which is not yet practical (§Open Questions). No server key; `blindPublicKeys` has no entry for this scheme. | Nobody but the client. |

The server's public key for `hpke-v1` is advertised in its capability object as `blindPublicKeys["hpke-v1"]` (base64url raw X25519 key) together with `blindEncryptionSchemes`. Because `server/discover` is the delivery channel, the key is only as trustworthy as that channel: on a TEE-backed server the key MUST be bound into the attestation's user-data field (base extension §TEE attestation formats, step 3) so the client can check that the key it encrypts to lives inside the attested enclave; otherwise it MUST be pinned like a verification key.

HTTP headers:

```http
MCP-Protocol-Version: 2026-07-28
Mcp-Method: verifiable-tools/call
```

`Mcp-Name` is only required by SEP-2243 for `tools/call`, `resources/read`, and `prompts/get`; it is not used for this custom method.

The server decrypts and evaluates the arguments inside a TEE or ZK circuit, computes the tool result, and returns the result with the base extension's verifiable metadata. The plaintext arguments MUST NOT be logged or retained outside the execution environment.

Blind execution hides *inputs*; it does not, by itself, hide anything about the *output*. A tool whose output is a function of a few private bits (e.g. `approved`/`declined`) leaks those bits to the operator. Tools with this shape SHOULD either return the output encrypted to the client (see §Encrypted replies) or run inside a TEE whose operator cannot read outputs.

#### Encrypted replies

Throughout this document `originalContent` denotes the plaintext `content` array as produced by the tool, before encryption; it is never transmitted as a field of its own.

When `replyPublicKey` is present the server MUST return `content` as a single `{ "type": "text", "text": "<base64url(enc || ciphertext)>" }` element, and the result `_meta[<companion identifier>].encryptedContent` MUST be `true`. Encryption is `hpke-v1` base mode with the same suite as blind arguments, plaintext = `JCS(originalContent)`, AAD = `JCS({tool, inputCommitment, nonce})` (nonce omitted from the object when absent), and `info` = UTF-8 `"<companion identifier>/hpke-v1/reply"`. The base extension's `outputCommitment` MUST be computed over the *plaintext* `originalContent`, so the client decrypts first and then runs the base extension's verification steps. `replyPublicKey` is ignored for non-blind `tools/call`.

| Result field | Type | Required | Description |
|---|---|---|---|
| `encryptedContent` | `boolean` | Optional | Whether `content` was encrypted under this section. |

#### Deferred proofs of blind results

For results of blind calls whose `content` was returned encrypted to `replyPublicKey`, the `verifiable-tools/prove` response (base extension §Deferred proofs) MUST re-encrypt the same `originalContent` under §Encrypted replies using the nonce of the `verifiable-tools/prove` request (or the original nonce if none was supplied); the ciphertext therefore differs while `outputCommitment`, computed over the plaintext, is unchanged. The `originalContent` underlying the deferred response is byte-identical to the original.

### Example request

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "verifiable-tools/call",
  "params": {
    "tool": "privateCreditCheck",
    "inputCommitment": "0xdeadbeef...",
    "encryptionScheme": "hpke-v1",
    "encryptedArguments": "<base64url(enc || ciphertext)>",
    "proofFormat": "tee-sgx-dcap-v1",
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {
          "io.github.ripple-node-lab/verifiable-tools": {
            "proofFormats": ["tee-sgx-dcap-v1"]
          },
          "io.github.ripple-node-lab/verifiable-tools-blind": {
            "blindExecution": true
          }
        }
      },
      "io.github.ripple-node-lab/verifiable-tools": {
        "nonce": "0x5f1c3a9e7b2d4c6f8a1e0d3b5c7f9a2e"
      }
    }
  }
}
```

### Example response

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "resultType": "complete",
    "content": [
      { "type": "text", "text": "approved" }
    ],
    "isError": false,
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "private-credit-server",
        "version": "1.0.0"
      },
      "io.github.ripple-node-lab/verifiable-tools": {
        "proof": "0x8f3a...",
        "proofFormat": "tee-sgx-dcap-v1",
        "inputCommitment": "0xdeadbeef...",
        "outputCommitment": "0x...",
        "nonce": "0x5f1c3a9e7b2d4c6f8a1e0d3b5c7f9a2e",
        "publicInputs": ["0x<outputCommitment>", "0x<inputCommitment>", "0x5f1c3a9e7b2d4c6f8a1e0d3b5c7f9a2e"],
        "teeAttestation": "0x9c2f..."
      }
    }
  }
}
```

The evidence lives under the *base* identifier: a blind result is verified by the base extension's verifier, which only needs the salt in addition.

### Verification flow

```mermaid
sequenceDiagram
    participant C as MCP Client
    participant S as MCP Server
    participant P as Proving Environment (TEE / ZK circuit)

    C->>C: salt = random(32); inputCommitment = SHA-256(salt || JCS(args))
    C->>S: verifiable-tools/call(tool, inputCommitment,<br/>encryptionScheme, encryptedArguments{salt,args}, proofFormat)
    S->>P: decrypt, check salt length + commitment, compute inside TEE / ZK circuit
    P-->>S: result + proof / teeAttestation
    S-->>C: CallToolResult (+ encryptedContent) + _meta[base identifier]
    C->>C: decrypt reply if encrypted; base-extension verification with salt
```

## Rationale

### Why a companion rather than part of the base extension?

Blind execution needs HPKE parameters, key distribution rules, reply encryption, re-encryption on deferred proofs, and an FHE reservation — roughly a quarter of the original draft — none of which a reviewer of *execution integrity* needs to evaluate. Keeping "one extension, one concern" makes the base extension reviewable on its own and lets confidentiality evolve (e.g. to vFHE) without reopening the binding rules.

### Why keep the salt branch in the base extension instead of here?

If the base extension fixed `inputCommitment = SHA-256(JCS(arguments))` with no salt, this companion would have to *redefine* the commitment, and a base-only verifier would be wire-incompatible with blind results. By leaving the construction (and the "empty or exactly 32 bytes" rule) in the base extension, this companion changes nothing in verifiers or in `publicInputs` — it only says where the 32 bytes come from and how they travel.

### Why a separate identifier?

A capability member on the base identifier would make "negotiate the base extension" ambiguous about whether blind calls are on the table, and would pull this document into every base-extension review. The cost — one more entry in `extensions` — is small.

## Backward Compatibility

- Servers and clients that do not support this companion continue to use the base extension unchanged; blind calls are never attempted unless both parties advertise `blindExecution: true` under the companion identifier.
- `_meta` keys prefixed with the companion identifier are ignored by implementations that do not recognize it.
- No new `resultType` values are introduced.

## Security Implications

- **Blind execution**: Encrypted arguments must be decrypted only inside the proving environment. Servers MUST NOT persist plaintext inputs or forward them to untrusted downstream systems.
- **Hiding commitments**: The salt exists because an unsalted hash of low-entropy arguments is trivially inverted by anyone who sees the commitment (base extension §Security Implications). Blind calls MUST use a fresh 32-byte random salt per call; salt reuse across calls links commitments of equal arguments.
- **Recipient key trust**: `blindPublicKeys["hpke-v1"]` is delivered over `server/discover`. On TEE-backed servers it MUST be bound into the attestation; otherwise it MUST be pinned. A client that encrypts to an unpinned, unattested key has hidden nothing from a man-in-the-middle at the discovery endpoint.
- **Output leakage**: Blind execution hides inputs, not outputs. Low-cardinality outputs SHOULD be returned encrypted (`replyPublicKey`) or computed inside a TEE whose operator cannot read them.
- **Side channels**: Proof generation time and memory can leak information about inputs. Implementations SHOULD use constant-time or padded proving schedules where side-channel resistance is required.
- **Deferred-proof retrieval**: A `resultId` for a blind result is a bearer capability to retained *plaintext* `content` and the plaintext witness; the base extension's scoping and expiry rules are therefore load-bearing for confidentiality, not just for integrity.
- **AAD binding**: Because `tool` and `inputCommitment` are in the HPKE AAD, a ciphertext cannot be replayed against a different tool or commitment; because `nonce` is in the reply AAD, a reply cannot be replayed to a later request.

## Reference Implementation

The demo repository implements this companion in full: `verifiable-tools/call` with `hpke-v1` (`node:crypto`, RFC 9180 base mode), salted 32-byte JCS commitments, encrypted replies via `replyPublicKey`, re-encryption on `verifiable-tools/prove`, attestation binding of the HPKE key for `tee-nitro-v1`, and negative tests for unsalted / wrongly-salted commitments (`tests/blind-call.test.ts`, `tests/hpke.test.ts`, `tests/binding.test.ts`, `tests/negative.test.ts`). See the identifier note above for the one known divergence from this document.

## Testing Plan

- Negative tests: malformed blind inputs; decrypted salt not 32 bytes; `inputCommitment` mismatch after decryption.
- Binding tests: an unsalted or wrongly salted blind commitment is rejected; a blind result verifies with the client's salt and fails with any other.
- Encrypted-reply tests: `outputCommitment` is over the plaintext; a deferred proof of an encrypted result re-encrypts under the new nonce with unchanged `outputCommitment`.
- Confidentiality tests: plaintext arguments never appear in server logs outside the proving environment.

## Alternatives Considered

- **Capability member of the base extension** (`blindExecution` under the base identifier): rejected, see Rationale.
- **Salt as a plaintext request field**: rejected; it would defeat the hiding property against a network observer.
- **Per-format commitment schemes (e.g. Pedersen) for hiding**: rejected for the base rule; SHA-256 with a 32-byte salt is engine-independent and already what every base verifier computes.

## Open Questions

- Verifiable FHE: `fhe-tfhe-v1` is reserved, but FHE alone gives confidentiality without execution integrity. What is the minimum viable vFHE construction (proof over the homomorphic evaluation, or TEE-hosted FHE evaluation) worth standardizing?
- Client-attested inputs: when the client, not the server, holds the secret, should the client be the prover ("the party holding the secret proves on the spot")? See `docs/EXTENSIONS.md` #3 in the reference repository.
- Should reviewers prefer this to be a separate extension identifier (as drafted) or a capability member of the base extension?
