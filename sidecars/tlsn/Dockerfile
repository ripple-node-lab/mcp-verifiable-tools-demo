# zktls-tlsn-v1 provenance sidecar. Runs a loopback HTTPS fixture
# (test-server.io), an in-process TLSNotary notary (secp256k1) and the HTTP
# API in one binary. tlsn deps are git-pinned to tag v0.1.0-alpha.15 via the
# committed Cargo.lock.
FROM rust:1.98-bookworm AS builder
WORKDIR /src
COPY sidecars/tlsn/ /src/
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates libssl3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /src/target/release/sidecar-tlsn /app/tlsn-sidecar
ENV HOST=0.0.0.0 PORT=4400 PUBLIC_URL=http://127.0.0.1:4400
EXPOSE 4400
CMD ["/app/tlsn-sidecar"]
