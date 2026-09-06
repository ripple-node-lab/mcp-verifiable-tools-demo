"""ezkl-v1 proving sidecar (stdlib http.server only).

Proves `add` (a + b = sum, u32) with a committed ezkl/Halo2 circuit:
packages/prover-ezkl/circuits/add/{model.compiled,settings.json,vk.json,kzg.srs}.
At startup it regenerates pk.json via ezkl.setup (vk is deterministic — the
produced vk is sha256-compared against the committed file to catch drift).
"""

import asyncio
import base64
import hashlib
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ezkl

ARTIFACTS = os.environ.get("EZKL_ARTIFACTS_DIR", "/app/artifacts")
MODEL = os.path.join(ARTIFACTS, "model.compiled")
SETTINGS = os.path.join(ARTIFACTS, "settings.json")
VK = os.path.join(ARTIFACTS, "vk.json")
SRS = os.path.join(ARTIFACTS, "kzg.srs")

MAX_BODY = 1 << 20
EMPTY_NONCE = "0x"
FIELD_MODULUS = (
    21888242871839275222246405745257275088548364400416034343698204186575808495617
)

# In-flight proof slots; aborting an HTTP request does not cancel the ezkl job.
_proof_slots: threading.Semaphore
_proof_lock = threading.Lock()
_max_proofs = 1


def circuit_hash() -> str:
    with open(VK, "rb") as f:
        return "0x" + hashlib.sha256(f.read()).hexdigest()


def felt_u32(felt_hex: str):
    """Decode a 32-byte little-endian field element hex string to int (< u32)."""
    value = int.from_bytes(bytes.fromhex(felt_hex.removeprefix("0x")), "little")
    return value if value <= 0xFFFFFFFF else None


def felt_hex(value: int) -> str:
    return value.to_bytes(32, "little").hex()


def prove_job(a: int, b: int) -> tuple[bytes, list]:
    """Run witness+prove; returns (proof_json_bytes, instances[0])."""
    with tempfile.TemporaryDirectory() as tmp:
        input_path = os.path.join(tmp, "input.json")
        witness_path = os.path.join(tmp, "witness.json")
        proof_path = os.path.join(tmp, "proof.json")
        with open(input_path, "w") as f:
            json.dump({"input_data": [[float(a)], [float(b)]]}, f)

        async def run():
            await ezkl.gen_witness(input_path, MODEL, witness_path)
            ezkl.prove(witness_path, MODEL, PK_PATH, proof_path, "single", SRS)

        asyncio.run(run())
        with open(proof_path, "rb") as f:
            proof_bytes = f.read()
        instances = json.loads(proof_bytes)["instances"][0]
        return proof_bytes, instances


def read_json_body(handler) -> dict:
    length = handler.headers.get("content-length")
    if length is not None and int(length) > MAX_BODY:
        raise ValueError("body too large")
    data = handler.rfile.read(min(int(length or 0), MAX_BODY + 1))
    if len(data) > MAX_BODY:
        raise ValueError("body too large")
    try:
        return json.loads(data)
    except Exception:
        raise ValueError("invalid JSON")


def _parse_u32(value) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 0xFFFFFFFF else None


def handle_prove(body: dict) -> tuple[int, dict]:
    if not _proof_slots.acquire(blocking=False):
        return 503, {"error": "busy"}
    try:
        if body.get("circuitHash") != circuit_hash():
            return 400, {"error": "circuitHashMismatch"}
        args = body.get("arguments") or {}
        a, b = _parse_u32(args.get("a")), _parse_u32(args.get("b"))
        if a is None or b is None or a + b > 0xFFFFFFFF:
            return 400, {"error": "invalidArguments"}
        total = a + b
        if body.get("output") is not None and body.get("output") != str(total):
            return 400, {"error": "outputMismatch"}
        try:
            proof_bytes, _instances = prove_job(a, b)
        except Exception as e:  # noqa: BLE001
            return 500, {"error": f"prove failed: {e}"}
        meta = {
            "proof": base64.urlsafe_b64encode(proof_bytes).rstrip(b"=").decode(),
            "proofFormat": "ezkl-v1",
            "circuitHash": circuit_hash(),
            "inputCommitment": body.get("inputCommitment"),
            "outputCommitment": body.get("outputCommitment"),
            "publicInputs": [
                body.get("outputCommitment"),
                body.get("inputCommitment"),
                body.get("nonce") or EMPTY_NONCE,
                str(total),
                str(a),
                str(b),
            ],
        }
        if body.get("nonce") is not None:
            meta["nonce"] = body["nonce"]
        if body.get("verificationKeyUri") is not None:
            meta["verificationKeyUri"] = body["verificationKeyUri"]
        return 200, meta
    finally:
        _proof_slots.release()


def handle_verify(body: dict) -> tuple[int, dict]:
    meta = body.get("meta") or {}
    expected = body.get("expectedCircuitHash") or ""
    if meta.get("proofFormat") != "ezkl-v1" or not isinstance(meta.get("proof"), str):
        return 200, {"ok": False, "reason": "malformed"}
    if meta.get("circuitHash") != expected or expected != circuit_hash():
        return 200, {"ok": False, "reason": "circuitHashMismatch"}
    try:
        proof_bytes = base64.urlsafe_b64decode(meta["proof"] + "===")
        proof = json.loads(proof_bytes)
    except Exception:
        return 200, {"ok": False, "reason": "malformed"}
    inputs = meta.get("publicInputs")
    if not isinstance(inputs, list) or len(inputs) != 6 or not all(isinstance(x, str) for x in inputs):
        return 200, {"ok": False, "reason": "malformed"}
    binding = [
        meta.get("outputCommitment"),
        meta.get("inputCommitment"),
        meta.get("nonce") if isinstance(meta.get("nonce"), str) else EMPTY_NONCE,
    ]
    if inputs[:3] != binding:
        return 200, {"ok": False, "reason": "publicInputsMismatch"}
    tail = inputs[3:]
    if not all(x.isdigit() for x in tail):
        return 200, {"ok": False, "reason": "instancesMismatch"}
    total, a, b = int(tail[0]), int(tail[1]), int(tail[2])
    if a + b != total or max(a, b, total) > 0xFFFFFFFF:
        return 200, {"ok": False, "reason": "instancesMismatch"}
    instances = proof.get("instances")
    expected_instances = [felt_hex(a), felt_hex(b), felt_hex(total)]
    if instances != [expected_instances]:
        return 200, {"ok": False, "reason": "instancesMismatch"}
    with tempfile.TemporaryDirectory() as tmp:
        proof_path = os.path.join(tmp, "proof.json")
        with open(proof_path, "wb") as f:
            f.write(proof_bytes)
        try:
            ok = ezkl.verify(proof_path, SETTINGS, VK, SRS)
        except Exception:
            ok = False
    return 200, {"ok": bool(ok), **({} if ok else {"reason": "proofInvalid"})}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, obj: dict):
        payload = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # quiet
        pass

    def do_GET(self):
        if self.path == "/healthz":
            self._send(200, {
                "status": "ok",
                "formats": ["ezkl-v1"],
                "circuitHash": circuit_hash(),
                "maxConcurrentProofs": _max_proofs,
            })
        elif self.path == f"/vk/{circuit_hash()}":
            with open(VK, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        try:
            body = read_json_body(self)
        except ValueError as e:
            self._send(400, {"error": str(e)})
            return
        if self.path == "/prove":
            status, obj = handle_prove(body)
        elif self.path == "/verify":
            status, obj = handle_verify(body)
        else:
            status, obj = 404, {"error": "not found"}
        self._send(status, obj)


def main():
    global _proof_slots, _max_proofs, PK_PATH
    _max_proofs = int(os.environ.get("MAX_CONCURRENT_PROOFS") or "1")
    if _max_proofs < 1:
        _max_proofs = 1
    _proof_slots = threading.Semaphore(_max_proofs)

    # Regenerate the proving key; the vk must be byte-identical to the
    # committed artifact — drift means the artifact set is inconsistent.
    with tempfile.TemporaryDirectory() as tmp:
        pk_path = os.path.join(tmp, "pk.json")
        vk_regen = os.path.join(tmp, "vk.json")
        ezkl.setup(MODEL, vk_regen, pk_path, SRS)
        with open(vk_regen, "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() != circuit_hash()[2:]:
                print("ezkl vk drifted from committed artifacts", file=sys.stderr)
                sys.exit(1)
        # pk must persist for the process lifetime — move to a stable temp file
        fd, PK_PATH = tempfile.mkstemp(suffix="-pk.json")
        os.close(fd)
        os.replace(pk_path, PK_PATH)

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "4300"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(
        f"ezkl sidecar listening on {host}:{port} circuitHash={circuit_hash()} "
        f"maxConcurrentProofs={_max_proofs}",
        file=sys.stderr,
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
