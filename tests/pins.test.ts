import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { expectedCircuitHash } from "@demo/protocol";
import { withServer } from "./helpers.js";

test("served ZK verification-key documents match their pinned hashes", async () => {
  await withServer(async (server) => {
    for (const format of ["snarkjs-v2", "noir-v1"]) {
      const hash = expectedCircuitHash("add", format);
      const response = await fetch(`${server.url}/vk/${hash}`);
      assert.equal(response.status, 200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.equal(`0x${createHash("sha256").update(bytes).digest("hex")}`, hash);
    }
  });
});
