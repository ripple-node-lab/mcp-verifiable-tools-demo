// zktls-tlsn-v1 provenance sidecar: fully local TLSNotary flow.
// One binary runs: a loopback HTTPS fixture ("test-server.io",
// GET /v1/price/{symbol}), an in-process notary over a duplex channel
// (secp256k1 signing key), the MPC-TLS prover, and the HTTP API.

use std::sync::{Arc, LazyLock};

use anyhow::Result;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures::io::{AsyncReadExt as _, AsyncWriteExt as _};
use futures_rustls::{
    TlsAcceptor,
    pki_types::{CertificateDer, PrivateKeyDer},
    rustls::{RootCertStore, ServerConfig, server::WebPkiClientVerifier},
};
use http_body_util::Empty;
use hyper::{
    Request,
    body::{Bytes, Incoming},
    server::conn::http1,
};
use hyper_util::rt::TokioIo;
use k256::pkcs8::{DecodePublicKey, EncodePublicKey};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};
use tower_service::Service;
use url::Url;

use tlsn::{
    Session,
    attestation::{
        Attestation, AttestationConfig, CryptoProvider,
        presentation::Presentation,
        request::{Request as AttestationRequest, RequestConfig},
        signing::{KeyAlgId, Secp256k1Signer, VerifyingKey},
    },
    config::{
        prove::ProveConfig, prover::ProverConfig, tls::TlsClientConfig,
        tls_commit::mpc::MpcTlsConfig, verifier::VerifierConfig,
    },
    connection::{CertBinding, ConnectionInfo, HandshakeData, ServerName, TranscriptLength},
    prover::ProverOutput,
    transcript::{ContentType, TranscriptCommitConfig},
    verifier::{ServerCertVerifier, VerifierCommitStart, VerifierOutput},
    webpki::{
        CertificateDer as WebPkiCertDer, PrivateKeyDer as WebPkiKeyDer,
        RootCertStore as WebPkiRootStore,
    },
};
use tlsn_formats::http::{DefaultHttpCommitter, HttpCommit, HttpTranscript};
use tlsn_server_fixture_certs::{
    CA_CERT_DER, CLIENT_CERT_DER, CLIENT_KEY_DER, SERVER_CERT_DER, SERVER_DOMAIN, SERVER_KEY_DER,
};

const MAX_SENT_DATA: usize = 1 << 12;
const MAX_RECV_DATA: usize = 1 << 14;
const MAX_BODY: usize = 1 << 20;
static SOURCE_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new("^/v1/price/[A-Za-z0-9._-]{1,16}$").unwrap());

struct AppState {
    fixture_port: u16,
    notary_key: k256::ecdsa::SigningKey,
    notary_pem: String,
    attest_slots: Semaphore,
    max_concurrent: usize,
    public_url: String,
}

// Matches packages/server/src/pricefeed.ts demoPrice (UTF-16 char codes —
// the source regex above restricts symbols to ASCII).
fn demo_price(symbol: &str) -> u32 {
    100 + (symbol.chars().map(|c| c as u32).sum::<u32>() % 400)
}

async fn price(Path(symbol): Path<String>) -> Json<Value> {
    Json(json!({ "currency": "USD", "price": demo_price(&symbol), "symbol": symbol }))
}

// Per-connection TLS+HTTP serving of the fixture app (mirrors
// tlsn-server-fixture::bind).
async fn serve_conn(socket: tokio::net::TcpStream) -> Result<()> {
    let key = PrivateKeyDer::Pkcs8(SERVER_KEY_DER.into());
    let cert = CertificateDer::from(SERVER_CERT_DER);
    let mut root_store = RootCertStore::empty();
    root_store.add(CA_CERT_DER.into())?;
    let client_verifier = WebPkiClientVerifier::builder(root_store.into())
        .allow_unauthenticated()
        .build()?;
    let config = ServerConfig::builder()
        .with_client_cert_verifier(client_verifier)
        .with_single_cert(vec![cert], key)?;
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let conn = acceptor.accept(socket.compat()).await?;
    let io = TokioIo::new(conn.compat());
    let app = Router::new().route("/v1/price/{symbol}", get(price));
    let service = hyper::service::service_fn(move |req: Request<Incoming>| app.clone().call(req));
    http1::Builder::new()
        .keep_alive(false)
        .serve_connection(io, service)
        .await?;
    Ok(())
}

async fn notarize<S: AsyncWrite + AsyncRead + Send + Sync + Unpin + 'static>(
    socket: S,
    signing_key: k256::ecdsa::SigningKey,
) -> Result<()> {
    let session = Session::new(socket.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let verifier_config = VerifierConfig::builder()
        .root_store(WebPkiRootStore {
            roots: vec![WebPkiCertDer(CA_CERT_DER.to_vec())],
        })
        .build()?;

    let verifier = match handle.new_verifier(verifier_config)?.commit().await? {
        VerifierCommitStart::Mpc(verifier) => verifier.accept().await?.run().await?,
        VerifierCommitStart::Proxy(verifier) => {
            verifier.reject(Some("expecting MPC-TLS")).await?;
            anyhow::bail!("protocol configuration rejected");
        }
    };

    let (
        VerifierOutput {
            transcript_commitments,
            ..
        },
        verifier,
    ) = verifier.verify().await?.accept().await?;
    let tls_transcript = verifier.tls_transcript().clone();
    verifier.close().await?;

    let sent_len = tls_transcript
        .sent()
        .iter()
        .filter_map(|r| matches!(r.typ, ContentType::ApplicationData).then_some(r.ciphertext.len()))
        .sum::<usize>();
    let recv_len = tls_transcript
        .recv()
        .iter()
        .filter_map(|r| matches!(r.typ, ContentType::ApplicationData).then_some(r.ciphertext.len()))
        .sum::<usize>();

    handle.close();
    let mut socket = driver_task.await??;

    let mut request_bytes = Vec::new();
    socket.read_to_end(&mut request_bytes).await?;
    let request: AttestationRequest = bincode::deserialize(&request_bytes)?;

    let signer = Box::new(Secp256k1Signer::new(&signing_key.to_bytes())?);
    let mut provider = CryptoProvider::default();
    provider.signer.set_signer(signer);

    let mut att_builder = AttestationConfig::builder();
    att_builder.supported_signature_algs(Vec::from_iter(provider.signer.supported_algs()));
    let att_config = att_builder.build()?;

    let CertBinding::V1_2(binding) = tls_transcript.certificate_binding() else {
        anyhow::bail!("unsupported cert binding version");
    };
    let mut builder = Attestation::builder(&att_config).accept_request(request)?;
    builder
        .connection_info(ConnectionInfo {
            time: tls_transcript.time(),
            version: tls_transcript.version(),
            transcript_length: TranscriptLength {
                sent: sent_len as u32,
                received: recv_len as u32,
            },
        })
        .server_ephemeral_key(binding.server_ephemeral_key.clone())
        .transcript_commitments(transcript_commitments);

    let attestation = builder.build(&provider)?;
    socket.write_all(&bincode::serialize(&attestation)?).await?;
    socket.close().await?;
    Ok(())
}

// Runs prover against the fixture + notary, returns the presentation and the
// revealed response body.
async fn attest(state: &AppState, symbol: &str) -> Result<(Presentation, String)> {
    let (notary_socket, prover_socket) = tokio::io::duplex(1 << 23);
    let notary_task = tokio::spawn(notarize(notary_socket, state.notary_key.clone()));

    let session = Session::new(prover_socket.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let prover = handle
        .new_prover(ProverConfig::builder().build()?)?
        .commit(
            MpcTlsConfig::builder()
                .max_sent_data(MAX_SENT_DATA)
                .max_recv_data(MAX_RECV_DATA)
                .build()?,
        )
        .await?;

    let client_socket = tokio::net::TcpStream::connect(("127.0.0.1", state.fixture_port)).await?;
    let (tls_connection, prover) = prover.connect(
        TlsClientConfig::builder()
            .server_name(ServerName::Dns(SERVER_DOMAIN.try_into()?))
            .root_store(WebPkiRootStore {
                roots: vec![WebPkiCertDer(CA_CERT_DER.to_vec())],
            })
            .client_auth((
                vec![WebPkiCertDer(CLIENT_CERT_DER.to_vec())],
                WebPkiKeyDer(CLIENT_KEY_DER.to_vec()),
            ))
            .build()?,
        client_socket.compat(),
    )?;
    let tls_connection = TokioIo::new(tls_connection.compat());
    let prover_task = tokio::spawn(prover.into_future());

    let (mut request_sender, connection) =
        hyper::client::conn::http1::handshake(tls_connection).await?;
    tokio::spawn(connection);

    let request = Request::builder()
        .uri(format!("/v1/price/{symbol}"))
        .header("Host", SERVER_DOMAIN)
        .header("Accept", "*/*")
        .header("Accept-Encoding", "identity")
        .header("Connection", "close")
        .header("User-Agent", "tlsn-sidecar/1.0")
        .body(Empty::<Bytes>::new())?;

    let response = request_sender.send_request(request).await?;
    if response.status() != StatusCode::OK {
        anyhow::bail!("fixture returned {}", response.status());
    }
    let mut prover = prover_task.await??;
    let body = HttpTranscript::parse(prover.transcript())?
        .responses
        .first()
        .and_then(|r| r.body.as_ref())
        .map(|b| String::from_utf8_lossy(&b.content_data()).to_string())
        .ok_or_else(|| anyhow::anyhow!("missing response body"))?;

    let transcript = HttpTranscript::parse(prover.transcript())?;
    let mut commit_builder = TranscriptCommitConfig::builder(prover.transcript());
    DefaultHttpCommitter::default().commit_transcript(&mut commit_builder, &transcript)?;
    let transcript_commit = commit_builder.build()?;

    let mut request_config_builder = RequestConfig::builder();
    request_config_builder.transcript_commit(transcript_commit);
    let request_config = request_config_builder.build()?;

    let mut disclosure_builder = ProveConfig::builder(prover.transcript());
    if let Some(config) = request_config.transcript_commit() {
        disclosure_builder.transcript_commit(config.clone());
    }
    let disclosure_config = disclosure_builder.build()?;

    let ProverOutput {
        transcript_commitments,
        transcript_secrets,
        ..
    } = prover.prove(&disclosure_config).await?;

    let prover_transcript = prover.transcript().clone();
    let tls_transcript = prover.tls_transcript().clone();
    prover.close().await?;

    let mut att_request_builder = AttestationRequest::builder(&request_config);
    att_request_builder
        .server_name(ServerName::Dns(SERVER_DOMAIN.try_into()?))
        .handshake_data(HandshakeData {
            certs: tls_transcript.server_cert_chain().unwrap().to_vec(),
            sig: tls_transcript.server_signature().unwrap().clone(),
            binding: tls_transcript.certificate_binding().clone(),
        })
        .transcript(prover_transcript)
        .transcript_commitments(transcript_secrets, transcript_commitments);
    let (request, secrets) = att_request_builder.build(&CryptoProvider::default())?;

    handle.close();
    let mut socket = driver_task.await??;
    socket.write_all(&bincode::serialize(&request)?).await?;
    socket.close().await?;
    let mut attestation_bytes = Vec::new();
    socket.read_to_end(&mut attestation_bytes).await?;
    let attestation: Attestation = bincode::deserialize(&attestation_bytes)?;
    request.validate(&attestation, &CryptoProvider::default())?;
    notary_task.await??;

    // Presentation: reveal request target + method + header names and the
    // full response body.
    let transcript = HttpTranscript::parse(secrets.transcript())?;
    let mut builder = secrets.transcript_proof_builder();
    let req = &transcript.requests[0];
    builder.reveal_sent(req.without_data())?;
    builder.reveal_sent(&req.request.target)?;
    for header in &req.headers {
        builder.reveal_sent(header.without_value())?;
    }
    let resp = &transcript.responses[0];
    builder.reveal_recv(resp.without_data())?;
    for header in &resp.headers {
        builder.reveal_recv(header)?;
    }
    builder.reveal_recv(resp.body.as_ref().unwrap())?;
    let transcript_proof = builder.build()?;

    let provider = CryptoProvider::default();
    let mut presentation_builder = attestation.presentation_builder(&provider);
    presentation_builder
        .identity_proof(secrets.identity_proof())
        .transcript_proof(transcript_proof);
    let presentation = presentation_builder.build()?;
    Ok((presentation, body))
}

fn bad_request(message: &str) -> (StatusCode, Json<Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": message })))
}

fn error_response(message: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": message })),
    )
}

fn parse_attestation(value: &Value) -> Result<AttestationFields, (StatusCode, Json<Value>)> {
    let get = |key: &str| -> Result<String, (StatusCode, Json<Value>)> {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| bad_request(&format!("invalid attestation.{key}")))
    };
    let attestation = AttestationFields {
        type_: get("type")?,
        source: get("source")?,
        commitment: get("commitment")?,
        data: get("data")?,
        proof: get("proof")?,
    };
    if attestation.type_ != "zktls-tlsn-v1" {
        return Err(bad_request("unsupported attestation type"));
    }
    if !attestation.commitment.starts_with("0x")
        || attestation.commitment.len() != 66
        || hex::decode(&attestation.commitment[2..]).is_err()
    {
        return Err(bad_request("invalid attestation.commitment"));
    }
    Ok(attestation)
}

struct AttestationFields {
    type_: String,
    source: String,
    commitment: String,
    data: String,
    proof: String,
}

fn validate_source(source: &str) -> Result<Url, (StatusCode, Json<Value>)> {
    let url = Url::parse(source).map_err(|_| bad_request("invalidSource"))?;
    if url.scheme() != "https"
        || url.host_str() != Some(SERVER_DOMAIN)
        || !SOURCE_RE.is_match(url.path())
    {
        return Err(bad_request("invalidSource"));
    }
    Ok(url)
}

async fn handle_healthz(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "types": ["zktls-tlsn-v1"],
        "notaryKeyUri": format!("{}/notary-key", state.public_url),
        "maxConcurrentAttestations": state.max_concurrent,
    }))
}

async fn handle_notary_key(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    (
        StatusCode::OK,
        [("content-type", "application/x-pem-file")],
        state.notary_pem.clone(),
    )
}

fn json_body(bytes: &Bytes) -> Result<Value, (StatusCode, Json<Value>)> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| bad_request("invalid JSON"))?;
    if !value.is_object() {
        return Err(bad_request("JSON body must be an object"));
    }
    Ok(value)
}

async fn handle_attest(
    State(state): State<Arc<AppState>>,
    bytes: Bytes,
) -> (StatusCode, Json<Value>) {
    let body = match json_body(&bytes) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let Some(source) = body.get("source").and_then(Value::as_str) else {
        return bad_request("invalidSource");
    };
    let url = match validate_source(source) {
        Ok(url) => url,
        Err(error) => return error,
    };
    let Ok(_slot) = state.attest_slots.try_acquire() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "busy" })),
        );
    };
    // The tlsn prover flow is !Send, so it runs on a dedicated current-thread
    // runtime inside a blocking task.
    let symbol = url.path()["/v1/price/".len()..].to_string();
    let attest_state = state.clone();
    let result = tokio::task::spawn_blocking(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?
            .block_on(attest(&attest_state, &symbol))
    })
    .await;
    match result {
        Ok(Ok((presentation, body))) => {
            let commitment = format!("0x{}", hex::encode(Sha256::digest(body.as_bytes())));
            (
                StatusCode::OK,
                Json(json!({
                    "type": "zktls-tlsn-v1",
                    "source": source,
                    "commitment": commitment,
                    "data": body,
                    "proof": URL_SAFE_NO_PAD.encode(bincode::serialize(&presentation).unwrap()),
                    "notaryKeyUri": format!("{}/notary-key", state.public_url),
                })),
            )
        }
        Ok(Err(error)) => error_response(&format!("attest failed: {error:#}")),
        Err(error) => error_response(&format!("attest failed: {error}")),
    }
}

async fn handle_verify(
    State(_state): State<Arc<AppState>>,
    bytes: Bytes,
) -> (StatusCode, Json<Value>) {
    let body = match json_body(&bytes) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let Some(attestation) = body.get("attestation") else {
        return bad_request("missing attestation");
    };
    let fields = match parse_attestation(attestation) {
        Ok(fields) => fields,
        Err(error) => return error,
    };
    let Some(notary_pem) = body.get("notaryKeyPem").and_then(Value::as_str) else {
        return bad_request("missing notaryKeyPem");
    };
    let url = match validate_source(&fields.source) {
        Ok(url) => url,
        Err(error) => return error,
    };
    match verify_presentation(&fields, &url, notary_pem) {
        Ok(server_name) => (
            StatusCode::OK,
            Json(json!({ "ok": true, "serverName": server_name, "data": fields.data })),
        ),
        Err(reason) => (
            StatusCode::OK,
            Json(json!({ "ok": false, "reason": reason })),
        ),
    }
}

fn verify_presentation(
    fields: &AttestationFields,
    url: &Url,
    notary_pem: &str,
) -> Result<String, String> {
    let proof = URL_SAFE_NO_PAD
        .decode(&fields.proof)
        .map_err(|_| "proofInvalid".to_string())?;
    let presentation: Presentation =
        bincode::deserialize(&proof).map_err(|_| "proofInvalid".to_string())?;
    let public_key = k256::PublicKey::from_public_key_pem(notary_pem)
        .map_err(|_| "notaryKeyInvalid".to_string())?;
    let notary_key = VerifyingKey {
        alg: KeyAlgId::K256,
        data: public_key.to_sec1_bytes().to_vec(),
    };
    if presentation.verifying_key() != &notary_key {
        return Err("notaryKeyMismatch".to_string());
    }
    let root = WebPkiRootStore {
        roots: vec![WebPkiCertDer(CA_CERT_DER.to_vec())],
    };
    let provider = CryptoProvider {
        cert: ServerCertVerifier::new(&root).map_err(|e| e.to_string())?,
        ..Default::default()
    };
    let output = presentation
        .verify(&provider)
        .map_err(|_| "presentationInvalid".to_string())?;
    let server_name = output
        .server_name
        .as_ref()
        .map(ToString::to_string)
        .ok_or_else(|| "serverNameMissing".to_string())?;
    if server_name != url.host_str().unwrap_or_default() {
        return Err("serverNameMismatch".to_string());
    }
    let mut partial = output
        .transcript
        .ok_or_else(|| "transcriptMissing".to_string())?;
    partial.set_unauthed(0);

    // Request line must be a GET for the exact source path.
    let sent = partial.sent_unsafe();
    let request_line = sent
        .split(|b| *b == b'\r')
        .next()
        .ok_or_else(|| "requestMissing".to_string())?;
    let parts: Vec<&[u8]> = request_line.split(|b| *b == b' ').collect();
    if parts.len() < 2 || parts[0] != b"GET" {
        return Err("requestMismatch".to_string());
    }
    if parts[1] != url.path().as_bytes() {
        return Err("requestMismatch".to_string());
    }

    let recv = partial.received_unsafe();
    let body_start = recv
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
        .ok_or_else(|| "responseMissing".to_string())?;
    let body = &recv[body_start..];
    if body.contains(&0) {
        return Err("bodyRedacted".to_string());
    }
    let body = std::str::from_utf8(body).map_err(|_| "responseMissing".to_string())?;
    let commitment = format!("0x{}", hex::encode(Sha256::digest(body.as_bytes())));
    if commitment != fields.commitment {
        return Err("commitmentMismatch".to_string());
    }
    if body != fields.data {
        return Err("dataMismatch".to_string());
    }
    Ok(server_name)
}

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info,tlsn=warn,sidecar_tlsn=debug")
        .init();

    let notary_key = match std::env::var("TLSN_NOTARY_KEY_HEX") {
        Ok(hex_key) => {
            let bytes = hex::decode(hex_key)?;
            k256::ecdsa::SigningKey::from_slice(&bytes)?
        }
        Err(_) => {
            let mut bytes = [0u8; 32];
            k256::elliptic_curve::rand_core::RngCore::fill_bytes(
                &mut k256::elliptic_curve::rand_core::OsRng,
                &mut bytes,
            );
            k256::ecdsa::SigningKey::from_slice(&bytes)?
        }
    };
    let notary_pem = notary_key
        .verifying_key()
        .to_public_key_pem(k256::elliptic_curve::pkcs8::LineEnding::LF)?;

    let max_concurrent: usize = std::env::var("MAX_CONCURRENT_ATTESTATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);
    let public_url =
        std::env::var("PUBLIC_URL").unwrap_or_else(|_| "http://127.0.0.1:4400".to_string());
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4400);

    let fixture = TcpListener::bind("127.0.0.1:0").await?;
    let fixture_port = fixture.local_addr()?.port();
    tokio::spawn(async move {
        while let Ok((socket, _)) = fixture.accept().await {
            tokio::spawn(async move { serve_conn(socket).await });
        }
    });

    let state = Arc::new(AppState {
        fixture_port,
        notary_key,
        notary_pem,
        attest_slots: Semaphore::new(max_concurrent),
        max_concurrent,
        public_url,
    });

    let app = Router::new()
        .route("/healthz", get(handle_healthz))
        .route("/notary-key", get(handle_notary_key))
        .route("/attest", post(handle_attest))
        .route("/verify", post(handle_verify))
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY))
        .with_state(state);

    let listener = TcpListener::bind((host.as_str(), port)).await?;
    tracing::info!("listening on {host}:{port}, fixture on 127.0.0.1:{fixture_port}");
    axum::serve(listener, app).await?;
    Ok(())
}
