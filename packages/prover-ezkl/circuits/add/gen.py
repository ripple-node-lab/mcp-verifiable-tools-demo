"""Regenerate the committed ezkl-v1 add circuit artifacts.

Usage: pip install "ezkl==22.0.1" onnx && python gen.py

Recipe (from the Phase 3-c PoC): a single ONNX Add node over [1] float inputs,
with input/param scale 0 so integers map exactly into BN254 field elements.
logrows=14 is the smallest setting @ezkljs/engine 22.0.1 can verify (engine
verify fails below 14 even though the python verifier passes).

Proof-level binding (V1 fix): besides a and b, the graph takes 48 more public
inputs — ob0..ob15, ib0..ib15, nb0..nb15 — the 16 big-endian u16 limbs of the
BN254 field element encoding outputCommitment, inputCommitment, and nonce
(the same reduction as protocol commitmentToField). u16 limbs stay < 2^24 so
they survive the f32 ONNX ingest exactly. ezkl publishes every public input in
the proof's instance column whether or not a node consumes it, so the limbs
need no passthrough.

The SRS (kzg.srs, logrows 14 = 2,097,412 bytes) is the perpetual
powers-of-tau SRS downloaded via `await ezkl.get_srs` — which is broken in
ezkl 22.0.1 ("input number is not less than field modulus"), so it was fetched
with ezkl 23.0.5 and committed. ezkl's local `gen_srs` output is insecure and
never verifies under @ezkljs/engine — do not use it here.
"""

import asyncio
import json
import os

import ezkl
import onnx
from onnx import TensorProto, helper

HERE = os.path.dirname(os.path.abspath(__file__))

BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617


def commitment_to_limbs(hex_str: str) -> list[int]:
    """Mirror protocol commitmentToU16Limbs: fe = int(hex, 16) % p → 16 BE u16 limbs."""
    clean = hex_str[2:] if hex_str.startswith("0x") else hex_str
    fe = (0 if clean == "" else int(clean, 16)) % BN254_SCALAR_FIELD
    return [(fe >> (16 * (15 - i))) & 0xFFFF for i in range(16)]


def input_row(a: int, b: int, out_commit: str, in_commit: str, nonce: str) -> list[list[float]]:
    """input.json input_data matching the graph's input order."""
    row = [[float(a)], [float(b)]]
    row += [[float(l)] for l in commitment_to_limbs(out_commit)]
    row += [[float(l)] for l in commitment_to_limbs(in_commit)]
    row += [[float(l)] for l in commitment_to_limbs(nonce)]
    return row


def main():
    node = helper.make_node("Add", ["a", "b"], ["sum"])
    bound_names = (
        [f"ob{i}" for i in range(16)]
        + [f"ib{i}" for i in range(16)]
        + [f"nb{i}" for i in range(16)]
    )
    graph_inputs = [
        helper.make_tensor_value_info("a", TensorProto.FLOAT, [1]),
        helper.make_tensor_value_info("b", TensorProto.FLOAT, [1]),
    ] + [helper.make_tensor_value_info(n, TensorProto.FLOAT, [1]) for n in bound_names]
    graph = helper.make_graph(
        [node],
        "add",
        graph_inputs,
        [helper.make_tensor_value_info("sum", TensorProto.FLOAT, [1])],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    onnx.save(model, os.path.join(HERE, "add.onnx"))

    run_args = ezkl.PyRunArgs()
    run_args.input_visibility = "public"
    run_args.output_visibility = "public"
    run_args.variables = [(n, 0) for n in ["a", "b"] + bound_names]
    run_args.input_scale = 0
    run_args.param_scale = 0
    run_args.logrows = 14
    settings_path = os.path.join(HERE, "settings.json")
    ezkl.gen_settings(os.path.join(HERE, "add.onnx"), settings_path, py_run_args=run_args)
    ezkl.compile_circuit(
        os.path.join(HERE, "add.onnx"), os.path.join(HERE, "model.compiled"), settings_path
    )

    async def rest():
        # get_srs is broken in ezkl 22.0.1; kzg.srs is committed instead.
        pk = os.path.join(HERE, "pk.json")
        vk = os.path.join(HERE, "vk.json")
        ezkl.setup(os.path.join(HERE, "model.compiled"), vk, pk, os.path.join(HERE, "kzg.srs"))
        # fixture proof (a=2, b=40) → sidecars/ezkl/fixtures/add-proof.json;
        # limbs match add-proof.meta.json's output/input commitments + nonce.
        data = input_row(
            2,
            40,
            "0x5f0cd6507175ef4a9450721e54fa2e534fe911bff7f37afdbba0c41ebe1f9458",
            "0xcbeb5e9673b2ac12665726b4bbc07a00bd3619838f961292227696fbe343440f",
            "0x11223344556677889900aabbccddee11",
        )
        with open(os.path.join(HERE, "input.json"), "w") as f:
            json.dump({"input_data": data}, f)
        await ezkl.gen_witness(
            os.path.join(HERE, "input.json"), os.path.join(HERE, "model.compiled"), os.path.join(HERE, "witness.json")
        )
        ezkl.prove(
            os.path.join(HERE, "witness.json"),
            os.path.join(HERE, "model.compiled"),
            pk,
            os.path.join(HERE, "proof.tmp.json"),
            "single",
            os.path.join(HERE, "kzg.srs"),
        )
        with open(os.path.join(HERE, "proof.tmp.json")) as f:
            print("instances:", json.load(f)["instances"])
        os.remove(pk)  # 117 MB — regenerated at sidecar startup, not committed

    asyncio.run(rest())


if __name__ == "__main__":
    main()
