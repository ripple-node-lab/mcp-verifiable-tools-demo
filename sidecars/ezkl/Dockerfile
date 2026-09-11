# ezkl-v1 proving sidecar. The committed circuit artifacts (vk/settings/
# model.compiled/kzg.srs) are copied in; pk.json is regenerated at container
# startup via ezkl.setup (vk keygen is deterministic — the produced vk is
# sha256-compared against the committed file to detect drift).
# ezkl is pinned to 22.0.1 because @ezkljs/engine only ships 22.0.1 and
# proof/vk/settings formats must match exactly.
# Alpine (musl) base: ezkl publishes linux wheels as manylinux x86_64 and
# musllinux {x86_64, aarch64} only, so the musl image installs natively on both
# amd64 and Apple Silicon (linux/arm64); a glibc image has no aarch64 wheel.
FROM python:3.12-alpine
RUN apk add --no-cache curl
COPY sidecars/ezkl/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY sidecars/ezkl/server.py /app/server.py
COPY packages/prover-ezkl/circuits/add/ /app/artifacts/
ENV HOST=0.0.0.0 PORT=4300 MAX_CONCURRENT_PROOFS=1
EXPOSE 4300
CMD ["python", "/app/server.py"]
