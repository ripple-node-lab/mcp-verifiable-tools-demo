# ezkl-v1 proving sidecar. The committed circuit artifacts (vk/settings/
# model.compiled/kzg.srs) are copied in; pk.json is regenerated at container
# startup via ezkl.setup (vk keygen is deterministic — the produced vk is
# sha256-compared against the committed file to detect drift).
# ezkl is pinned to 22.0.1 because @ezkljs/engine only ships 22.0.1 and
# proof/vk/settings formats must match exactly.
FROM python:3.12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
COPY sidecars/ezkl/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY sidecars/ezkl/server.py /app/server.py
COPY packages/prover-ezkl/circuits/add/ /app/artifacts/
ENV HOST=0.0.0.0 PORT=4300 MAX_CONCURRENT_PROOFS=1
EXPOSE 4300
CMD ["python", "/app/server.py"]
