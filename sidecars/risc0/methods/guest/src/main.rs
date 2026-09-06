use risc0_zkvm::guest::env;

fn main() {
    let (a, b): (u32, u32) = env::read();
    let sum: u32 = a.checked_add(b).expect("add overflow");
    // journal = exactly 12 bytes LE: a || b || sum
    let journal = [a.to_le_bytes(), b.to_le_bytes(), sum.to_le_bytes()].concat();
    env::commit_slice(&journal);
}
