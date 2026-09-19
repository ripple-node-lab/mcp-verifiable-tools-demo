fn main(a: pub u32, b: pub u32, out_commit: pub Field, in_commit: pub Field, nonce: pub Field) -> pub u32 {
    // out_commit/in_commit/nonce are unconstrained public inputs — UltraHonk
    // verification commits to all public inputs, so the proof is bound to the
    // exact commitments and nonce it was proven for (replay protection).
    a + b
}
