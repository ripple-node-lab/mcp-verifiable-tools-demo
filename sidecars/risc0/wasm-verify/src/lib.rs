// Minimal risc0 receipt verifier compiled to wasm32-unknown-unknown.
// Exports a raw C ABI (no wasm-bindgen): wasm_alloc/wasm_free manage
// input buffers, verify_receipt() checks a bincode-serialized composite
// or succinct Receipt against an image id, and journal_ptr/journal_len
// expose the journal of the last successfully verified receipt.
use risc0_zkvm::{Digest, InnerReceipt, Receipt};
use std::alloc::{alloc, dealloc, Layout};
use std::sync::Mutex;

static JOURNAL: Mutex<Vec<u8>> = Mutex::new(Vec::new());

#[no_mangle]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    unsafe { alloc(Layout::from_size_align(len, 1).unwrap()) }
}

/// # Safety
/// `ptr`/`len` must come from `wasm_alloc`.
#[no_mangle]
pub unsafe extern "C" fn wasm_free(ptr: *mut u8, len: usize) {
    dealloc(ptr, Layout::from_size_align(len, 1).unwrap())
}

/// returns 1 = verified, 0 = verification failed (incl. Fake/dev receipts),
/// -1 = malformed input
///
/// # Safety
/// `receipt_ptr` must point to `receipt_len` readable bytes and `id_ptr` to 32
/// readable bytes (the image id as 8 LE u32 words).
#[no_mangle]
pub unsafe extern "C" fn verify_receipt(
    receipt_ptr: *const u8,
    receipt_len: usize,
    id_ptr: *const u8,
) -> i32 {
    JOURNAL.lock().unwrap().clear();
    if id_ptr.is_null() {
        return -1;
    }
    let bytes = std::slice::from_raw_parts(receipt_ptr, receipt_len);
    let id_bytes = std::slice::from_raw_parts(id_ptr, 32);
    let receipt: Receipt = match bincode::deserialize(bytes) {
        Ok(r) => r,
        Err(_) => return -1,
    };
    if matches!(receipt.inner, InnerReceipt::Fake(_)) {
        return 0;
    }
    let mut words = [0u32; 8];
    for (i, chunk) in id_bytes.chunks(4).enumerate() {
        words[i] = u32::from_le_bytes(chunk.try_into().unwrap());
    }
    match receipt.verify(Digest::from(words)) {
        Ok(()) => {
            *JOURNAL.lock().unwrap() = receipt.journal.bytes.clone();
            1
        }
        Err(_) => 0,
    }
}

#[no_mangle]
pub extern "C" fn journal_ptr() -> *const u8 {
    let guard = JOURNAL.lock().unwrap();
    if guard.is_empty() {
        core::ptr::null()
    } else {
        guard.as_ptr()
    }
}

#[no_mangle]
pub extern "C" fn journal_len() -> usize {
    JOURNAL.lock().unwrap().len()
}
