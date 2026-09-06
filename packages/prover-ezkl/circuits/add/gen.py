"""Regenerate the committed ezkl-v1 add circuit artifacts.

Usage: pip install "ezkl==22.0.1" onnx && python gen.py

Recipe (from the Phase 3-c PoC): a single ONNX Add node over [1] float inputs,
with input/param scale 0 so integers map exactly into BN254 field elements.
logrows=14 is the smallest setting @ezkljs/engine 22.0.1 can verify (engine
verify fails below 14 even though the python verifier passes).

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


def main():
    node = helper.make_node("Add", ["a", "b"], ["sum"])
    graph = helper.make_graph(
        [node],
        "add",
        [
            helper.make_tensor_value_info("a", TensorProto.FLOAT, [1]),
            helper.make_tensor_value_info("b", TensorProto.FLOAT, [1]),
        ],
        [helper.make_tensor_value_info("sum", TensorProto.FLOAT, [1])],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    onnx.save(model, os.path.join(HERE, "add.onnx"))

    run_args = ezkl.PyRunArgs()
    run_args.input_visibility = "public"
    run_args.output_visibility = "public"
    run_args.variables = [("a", 0), ("b", 0)]
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
        with open(os.path.join(HERE, "input.json"), "w") as f:
            json.dump({"input_data": [[2.0], [40.0]]}, f)
        await ezkl.gen_witness(
            os.path.join(HERE, "input.json"), os.path.join(HERE, "model.compiled"), os.path.join(HERE, "witness.json")
        )
        # fixture proof (a=2, b=40) → sidecars/ezkl/fixtures/add-proof.json
        ezkl.prove(
            os.path.join(HERE, "witness.json"),
            os.path.join(HERE, "model.compiled"),
            pk,
            os.path.join(HERE, "proof.tmp.json"),
            "single",
            os.path.join(HERE, "kzg.srs"),
        )
        os.remove(pk)  # 117 MB — regenerated at sidecar startup, not committed

    asyncio.run(rest())


if __name__ == "__main__":
    main()
