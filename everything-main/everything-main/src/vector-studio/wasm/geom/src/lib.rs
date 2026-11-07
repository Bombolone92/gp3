//! Vector Studio geometry engine, compiled to wasm32-unknown-unknown with
//! raw exports (no bindings generator).
//!
//! JavaScript allocates an f64 buffer with `geom_alloc`, writes the encoded
//! shapes into linear memory, calls `geom_run(op, ptr, len, tol)` and reads
//! the encoded result from `geom_out_ptr()` / `geom_out_len()`. See
//! `model::parse` and `model::write` for the formats.

pub mod model;
pub mod ops;
pub mod recon;

use core::cell::UnsafeCell;

struct Out(UnsafeCell<Vec<f64>>);
// Wasm is single-threaded here; the buffer is only touched from exports.
unsafe impl Sync for Out {}
static OUT: Out = Out(UnsafeCell::new(Vec::new()));

fn out() -> &'static mut Vec<f64> {
    unsafe { &mut *OUT.0.get() }
}

#[no_mangle]
pub extern "C" fn geom_alloc(n: usize) -> *mut f64 {
    let mut v: Vec<f64> = Vec::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn geom_free(p: *mut f64, n: usize) {
    if !p.is_null() {
        drop(Vec::from_raw_parts(p, 0, n.max(1)));
    }
}

#[no_mangle]
pub extern "C" fn geom_out_ptr() -> *const f64 {
    out().as_ptr()
}

#[no_mangle]
pub extern "C" fn geom_out_len() -> usize {
    out().len()
}

/// Run an operation; returns 0 on success, 1 on a malformed input.
#[no_mangle]
pub unsafe extern "C" fn geom_run(op: u32, ptr: *const f64, len: usize, tol: f64) -> i32 {
    let buf = core::slice::from_raw_parts(ptr, len);
    match run(op, buf, tol) {
        Some(v) => {
            *out() = v;
            0
        }
        None => {
            out().clear();
            1
        }
    }
}

/// Safe entry point used by the exports and by native tests.
pub fn run(op: u32, buf: &[f64], tol: f64) -> Option<Vec<f64>> {
    let (params, shapes) = model::parse(buf)?;
    let tol = if tol.is_finite() && tol > 0.0 { tol } else { 0.01 };
    let res = match op {
        ops::OP_UNITE | ops::OP_INTERSECT | ops::OP_EXCLUDE | ops::OP_MINUS_FRONT | ops::OP_MINUS_BACK => ops::shape_mode(op, &shapes, tol),
        ops::OP_DIVIDE | ops::OP_TRIM | ops::OP_MERGE | ops::OP_CROP | ops::OP_OUTLINE => ops::pathfinder(op, &shapes, tol),
        ops::OP_SUBTRACT_EACH => ops::subtract_each(&shapes, tol, false),
        ops::OP_DIVIDE_BELOW => ops::subtract_each(&shapes, tol, true),
        ops::OP_SLICE_EACH => ops::slice_each(&shapes, tol),
        ops::OP_STROKE => ops::outline_stroke(&params, &shapes, tol),
        ops::OP_OFFSET => ops::offset_path(&params, &shapes, tol),
        ops::OP_SIMPLIFY => ops::simplify(&params, &shapes),
        ops::OP_NORMALIZE => ops::normalize(&shapes, tol),
        ops::OP_UNITE_GROUPS => ops::unite_groups(&shapes, tol),
        _ => return None,
    };
    let mut v = Vec::new();
    model::write(&mut v, &res);
    Some(v)
}
