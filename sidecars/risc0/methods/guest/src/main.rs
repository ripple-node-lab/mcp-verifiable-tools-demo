use risc0_zkvm::guest::env;

fn main() {
    // bound_* are sha256(hex-string) digests of the meta commitments/nonce,
    // computed by the host — the guest only commits them into the journal.
    let (a, b, out_commit, in_commit, nonce): (u32, u32, [u8; 32], [u8; 32], [u8; 32]) =
        env::read();
    let sum: u32 = a.checked_add(b).expect("add overflow");
    // journal = 108 bytes LE: a || b || sum || out_commit || in_commit || nonce
    // The three bound digests make the receipt non-replayable: verification
    // recomputes them from meta and compares against the committed journal.
    let mut journal = Vec::with_capacity(108);
    journal.extend_from_slice(&a.to_le_bytes());
    journal.extend_from_slice(&b.to_le_bytes());
    journal.extend_from_slice(&sum.to_le_bytes());
    journal.extend_from_slice(&out_commit);
    journal.extend_from_slice(&in_commit);
    journal.extend_from_slice(&nonce);
    env::commit_slice(&journal);
}
