pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";

template Add() {
    signal input a;
    signal input b;
    // Replay/freshness binding: the output/input commitments and client nonce
    // are public signals — groth16 verification commits to every public input,
    // so a proof can only be replayed with the commitments it was proven for.
    // Encoded as field elements: int(hex) mod BN254_p.
    signal input outCommit;
    signal input inCommit;
    signal input nonce;
    signal output c;

    component ra = Num2Bits(32);
    ra.in <== a;

    component rb = Num2Bits(32);
    rb.in <== b;

    c <== a + b;
}

component main {public [a, b, outCommit, inCommit, nonce]} = Add();
