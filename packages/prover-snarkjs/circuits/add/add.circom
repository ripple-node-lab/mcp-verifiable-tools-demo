pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";

template Add() {
    signal input a;
    signal input b;
    signal output c;

    component ra = Num2Bits(32);
    ra.in <== a;

    component rb = Num2Bits(32);
    rb.in <== b;

    c <== a + b;
}

component main {public [a, b]} = Add();
