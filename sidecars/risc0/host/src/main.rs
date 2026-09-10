use base64::Engine;
use methods::{ADD_GUEST_ELF, ADD_GUEST_ID};
use risc0_zkvm::{default_prover, Digest, ExecutorEnv, InnerReceipt, ProverOpts, Receipt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicUsize, Ordering};
use tiny_http::{Header, Method, Response, Server};

// 2 MiB: a composite receipt is ~222 KB serialized (~300 KB base64url in meta.proof).
const MAX_BODY: u64 = 2 * 1024 * 1024;
const EMPTY_NONCE: &str = "0x";
static IN_FLIGHT_PROOFS: AtomicUsize = AtomicUsize::new(0);

fn max_concurrent_proofs() -> usize {
    std::env::var("MAX_CONCURRENT_PROOFS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(1)
}

// Decrements the in-flight proof counter on drop. Cancellation of an
// in-flight proof is not supported: aborting the request still runs the
// r0vm job to completion and only then frees the slot.
struct ProofSlot;
impl Drop for ProofSlot {
    fn drop(&mut self) {
        IN_FLIGHT_PROOFS.fetch_sub(1, Ordering::SeqCst);
    }
}
fn try_acquire_proof_slot() -> Option<ProofSlot> {
    let limit = max_concurrent_proofs();
    loop {
        let current = IN_FLIGHT_PROOFS.load(Ordering::SeqCst);
        if current >= limit {
            return None;
        }
        if IN_FLIGHT_PROOFS
            .compare_exchange(current, current + 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            return Some(ProofSlot);
        }
    }
}

fn image_id_bytes() -> [u8; 32] {
    bytemuck::cast::<[u32; 8], [u8; 32]>(ADD_GUEST_ID)
}

fn image_id_hex() -> String {
    format!("0x{}", hex::encode(image_id_bytes()))
}

fn dev_mode() -> bool {
    matches!(std::env::var("RISC0_DEV_MODE").as_deref(), Ok(v) if !v.is_empty() && v != "0" && v != "false")
}

fn respond(request: tiny_http::Request, status: u16, body: Value) {
    let json = serde_json::to_string(&body).unwrap();
    let response = Response::from_string(json)
        .with_status_code(status)
        .with_header(Header::from_bytes("content-type", "application/json").unwrap());
    let _ = request.respond(response);
}

fn read_body(request: &mut tiny_http::Request) -> Result<Value, String> {
    if request.body_length().map_or(0, |n| n as u64) > MAX_BODY {
        return Err("body too large".into());
    }
    let mut buf = Vec::new();
    request
        .as_reader()
        .take(MAX_BODY + 1)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.len() as u64 > MAX_BODY {
        return Err("body too large".into());
    }
    serde_json::from_slice(&buf).map_err(|_| "invalid JSON".to_string())
}

#[derive(Deserialize)]
struct ProveInput {
    arguments: Option<Value>,
    #[serde(rename = "circuitHash")]
    circuit_hash: String,
    #[serde(rename = "inputCommitment")]
    input_commitment: String,
    #[serde(rename = "outputCommitment")]
    output_commitment: String,
    nonce: Option<String>,
    output: Option<String>,
    #[serde(rename = "inputAttestations")]
    input_attestations: Option<Vec<Value>>,
}

fn parse_u32(v: &Value, key: &str) -> Option<u32> {
    v.get(key)?.as_u64().and_then(|n| u32::try_from(n).ok())
}

fn make_receipt(a: u32, b: u32) -> Result<Receipt, String> {
    let env = ExecutorEnv::builder()
        .write(&(a, b))
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let prover = default_prover();
    prover
        .prove_with_opts(env, ADD_GUEST_ELF, &ProverOpts::composite())
        .map(|info| info.receipt)
        .map_err(|e| e.to_string())
}

fn prove(request: &mut tiny_http::Request) -> (u16, Value) {
    let Some(_slot) = try_acquire_proof_slot() else {
        return (503, json!({ "error": "busy" }));
    };
    let image_id = image_id_hex();
    let body = match read_body(request) {
        Ok(v) => v,
        Err(e) => return (400, json!({ "error": e })),
    };
    let input: ProveInput = match serde_json::from_value(body) {
        Ok(v) => v,
        Err(_) => return (400, json!({ "error": "invalid ProveInput" })),
    };
    if input.circuit_hash != image_id {
        return (400, json!({ "error": "circuitHashMismatch" }));
    }
    // publicInputs are a fixed 6-element layout; attestation commitments cannot
    // be appended, so risc0-v1 cannot carry input provenance at all.
    if input
        .input_attestations
        .as_ref()
        .is_some_and(|list| !list.is_empty())
    {
        return (
            400,
            json!({ "error": "unsupported: risc0-v1 does not carry inputAttestations" }),
        );
    }
    let args = input.arguments.unwrap_or(Value::Null);
    let (a, b) = match (parse_u32(&args, "a"), parse_u32(&args, "b")) {
        (Some(a), Some(b)) => (a, b),
        _ => return (400, json!({ "error": "invalidArguments" })),
    };
    let sum = match a.checked_add(b) {
        Some(s) => s,
        None => return (400, json!({ "error": "invalidArguments" })),
    };
    if input.output.as_deref() != Some(&sum.to_string()) {
        return (400, json!({ "error": "outputMismatch" }));
    }
    let receipt = match make_receipt(a, b) {
        Ok(r) => r,
        Err(e) => return (500, json!({ "error": e })),
    };
    let journal: &[u8] = &receipt.journal.bytes;
    if journal != [a.to_le_bytes(), b.to_le_bytes(), sum.to_le_bytes()].concat() {
        return (500, json!({ "error": "journalMismatch" }));
    }
    let proof = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(bincode::serialize(&receipt).unwrap());
    let mut meta = json!({
        "proof": proof,
        "proofFormat": "risc0-v1",
        "circuitHash": input.circuit_hash,
        "inputCommitment": input.input_commitment,
        "outputCommitment": input.output_commitment,
        "publicInputs": [
            input.output_commitment,
            input.input_commitment,
            input.nonce.as_deref().unwrap_or(EMPTY_NONCE),
            sum.to_string(), a.to_string(), b.to_string(),
        ],
    });
    if let Some(nonce) = input.nonce {
        meta["nonce"] = json!(nonce);
    }
    (200, meta)
}

fn verify(request: &mut tiny_http::Request) -> (u16, Value) {
    let body = match read_body(request) {
        Ok(v) => v,
        Err(e) => return (400, json!({ "error": e })),
    };
    let meta = body.get("meta").cloned().unwrap_or(Value::Null);
    let expected = body
        .get("expectedCircuitHash")
        .and_then(Value::as_str)
        .unwrap_or("");
    if meta.get("proofFormat").and_then(Value::as_str) != Some("risc0-v1") {
        return (200, json!({ "ok": false, "reason": "malformed" }));
    }
    if meta.get("circuitHash").and_then(Value::as_str) != Some(expected) {
        return (200, json!({ "ok": false, "reason": "circuitHashMismatch" }));
    }
    let id_bytes = match hex::decode(expected.strip_prefix("0x").unwrap_or(expected)) {
        Ok(b) if b.len() == 32 => b,
        _ => return (200, json!({ "ok": false, "reason": "circuitHashMismatch" })),
    };
    let mut words = [0u32; 8];
    for (i, chunk) in id_bytes.chunks(4).enumerate() {
        words[i] = u32::from_le_bytes(chunk.try_into().unwrap());
    }
    let proof_b64 = match meta.get("proof").and_then(Value::as_str) {
        Some(p) => p,
        None => return (200, json!({ "ok": false, "reason": "malformed" })),
    };
    let bytes = match base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(proof_b64) {
        Ok(b) => b,
        Err(_) => return (200, json!({ "ok": false, "reason": "malformed" })),
    };
    let receipt: Receipt = match bincode::deserialize(&bytes) {
        Ok(r) => r,
        Err(_) => return (200, json!({ "ok": false, "reason": "malformed" })),
    };
    if matches!(receipt.inner, InnerReceipt::Fake(_)) && !dev_mode() {
        return (200, json!({ "ok": false, "reason": "devModeReceipt" }));
    }
    if receipt.verify(Digest::from(words)).is_err() {
        return (200, json!({ "ok": false, "reason": "receiptInvalid" }));
    }
    let journal: &[u8] = &receipt.journal.bytes;
    if journal.len() != 12 {
        return (200, json!({ "ok": false, "reason": "journalMismatch" }));
    }
    let a = u32::from_le_bytes(journal[0..4].try_into().unwrap());
    let b = u32::from_le_bytes(journal[4..8].try_into().unwrap());
    let sum = u32::from_le_bytes(journal[8..12].try_into().unwrap());
    if a.checked_add(b) != Some(sum) {
        return (200, json!({ "ok": false, "reason": "journalMismatch" }));
    }
    let inputs = meta.get("publicInputs").and_then(Value::as_array);
    let Some(inputs) = inputs else {
        return (200, json!({ "ok": false, "reason": "malformed" }));
    };
    let str_entry = |i: usize| inputs.get(i).and_then(Value::as_str);
    let nonce = meta
        .get("nonce")
        .and_then(Value::as_str)
        .unwrap_or(EMPTY_NONCE);
    let binding = [
        meta.get("outputCommitment").and_then(Value::as_str),
        meta.get("inputCommitment").and_then(Value::as_str),
        Some(nonce),
    ];
    if inputs.len() != 6 || binding != [str_entry(0), str_entry(1), str_entry(2)] {
        return (
            200,
            json!({ "ok": false, "reason": "publicInputsMismatch" }),
        );
    }
    let tail = [sum.to_string(), a.to_string(), b.to_string()];
    if str_entry(3) != Some(tail[0].as_str())
        || str_entry(4) != Some(tail[1].as_str())
        || str_entry(5) != Some(tail[2].as_str())
    {
        return (200, json!({ "ok": false, "reason": "journalMismatch" }));
    }
    (200, json!({ "ok": true }))
}

fn handle(mut request: tiny_http::Request) {
    let url = request.url().to_string();
    match (request.method(), url.as_str()) {
        (&Method::Get, "/healthz") => respond(
            request,
            200,
            json!({
                "status": "ok",
                "formats": ["risc0-v1"],
                "imageId": image_id_hex(),
                "devMode": dev_mode(),
                "maxConcurrentProofs": max_concurrent_proofs(),
            }),
        ),
        (&Method::Post, "/prove") => {
            let (status, body) = prove(&mut request);
            respond(request, status, body);
        }
        (&Method::Post, "/verify") => {
            let (status, body) = verify(&mut request);
            respond(request, status, body);
        }
        (&Method::Get, path) if path.starts_with("/vk/") => {
            if path[4..] == image_id_hex() {
                respond(
                    request,
                    200,
                    json!({ "format": "risc0-v1", "imageId": image_id_hex() }),
                );
            } else {
                respond(request, 404, json!({ "error": "unknown circuitHash" }));
            }
        }
        _ => respond(request, 404, json!({ "error": "not found" })),
    }
}

fn main() {
    if let Ok(path) = std::env::var("RISC0_EXPECT_IMAGE_ID_FILE") {
        let expected = std::fs::read_to_string(&path).unwrap().trim().to_string();
        assert_eq!(
            expected,
            image_id_hex(),
            "guest image id drifted from {path}"
        );
    }
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port = std::env::var("PORT").unwrap_or_else(|_| "4200".into());
    let server = Server::http(format!("{host}:{port}")).unwrap();
    eprintln!(
        "risc0 sidecar listening on {host}:{port} imageId={} devMode={}",
        image_id_hex(),
        dev_mode()
    );
    for request in server.incoming_requests() {
        std::thread::spawn(move || handle(request));
    }
}
