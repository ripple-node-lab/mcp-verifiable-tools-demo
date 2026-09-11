# x86_64-only image: risc0-build 3.0.6 has no Linux aarch64 support and the
# toolchain tarballs below are x86_64; docker-compose.yml pins
# `platform: linux/amd64` so Apple Silicon builds/runs it under emulation.
# risc0-v1 proving sidecar. The guest ELF is compiled inside this image with
# the pinned rzup toolchain layout (replicated via direct release downloads so
# the build does not depend on the GitHub API / rzup). Bump the versions below
# together with sidecars/risc0/image-id.txt and the PINNED_CIRCUITS entry.
FROM rust:1-bookworm AS builder
ARG RISC0_VERSION=3.0.6
ARG RISC0_RUST_VERSION=1.97.0
ARG RISC0_CPP_VERSION=2024.1.5
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
 && rm -rf /var/lib/apt/lists/*
# rzup-compatible toolchain layout under /root/.risc0
RUN set -eux; \
    mkdir -p /root/.risc0/toolchains /root/.risc0/extensions /root/.rustup/toolchains \
             "/root/.risc0/toolchains/v${RISC0_RUST_VERSION}-rust-x86_64-unknown-linux-gnu"; \
    curl -fsSL "https://github.com/risc0/rust/releases/download/r0.${RISC0_RUST_VERSION}/rust-toolchain-x86_64-unknown-linux-gnu.tar.gz" \
      | tar xz -C "/root/.risc0/toolchains/v${RISC0_RUST_VERSION}-rust-x86_64-unknown-linux-gnu"
RUN set -eux; \
    curl -fsSL "https://github.com/risc0/toolchain/releases/download/2024.01.05/riscv32im-linux-x86_64.tar.xz" \
      | tar xJ -C /tmp; \
    mkdir -p "/root/.risc0/toolchains/v${RISC0_CPP_VERSION}-cpp-x86_64-unknown-linux-gnu"; \
    mv /tmp/riscv32im-linux-x86_64 "/root/.risc0/toolchains/v${RISC0_CPP_VERSION}-cpp-x86_64-unknown-linux-gnu/"
RUN set -eux; \
    mkdir -p "/root/.risc0/extensions/v${RISC0_VERSION}-cargo-risczero-x86_64-unknown-linux-gnu"; \
    curl -fsSL "https://github.com/risc0/risc0/releases/download/v${RISC0_VERSION}/cargo-risczero-x86_64-unknown-linux-gnu.tgz" \
      | tar xz -C "/root/.risc0/extensions/v${RISC0_VERSION}-cargo-risczero-x86_64-unknown-linux-gnu"
RUN set -eux; \
    printf '[default_versions]\ncpp = "%s"\nr0vm = "%s"\ncargo-risczero = "%s"\nrust = "%s"\n' \
      "${RISC0_CPP_VERSION}" "${RISC0_VERSION}" "${RISC0_VERSION}" "${RISC0_RUST_VERSION}" > /root/.risc0/settings.toml; \
    ln -sfn "/root/.risc0/toolchains/v${RISC0_RUST_VERSION}-rust-x86_64-unknown-linux-gnu" /root/.rustup/toolchains/risc0; \
    ln -sfn "/root/.risc0/extensions/v${RISC0_VERSION}-cargo-risczero-x86_64-unknown-linux-gnu/r0vm" /usr/local/bin/r0vm; \
    ln -sfn "/root/.risc0/extensions/v${RISC0_VERSION}-cargo-risczero-x86_64-unknown-linux-gnu/cargo-risczero" /usr/local/bin/cargo-risczero
WORKDIR /src
COPY sidecars/risc0/ /src/
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates libssl3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /src/target/release/host /app/risc0-sidecar
COPY --from=builder /root/.risc0/extensions/v3.0.6-cargo-risczero-x86_64-unknown-linux-gnu/r0vm /usr/local/bin/r0vm
COPY sidecars/risc0/image-id.txt /app/image-id.txt
ENV HOST=0.0.0.0 PORT=4200 RISC0_EXPECT_IMAGE_ID_FILE=/app/image-id.txt
EXPOSE 4200
CMD ["/app/risc0-sidecar"]
