//! Audio sample kernels for Video Studio, compiled to WebAssembly.
//!
//! No allocator and no bindings generator: JavaScript reserves scratch memory
//! with `reserve`, writes samples into it and calls the kernels with byte
//! offsets. All buffers are little-endian f32.
#![no_std]

use core::panic::PanicInfo;
use core::slice;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const PAGE: usize = 65536;

extern "C" {
    static __heap_base: u8;
}

/// Make sure linear memory holds at least `bytes` bytes past the heap base and
/// return the offset of that scratch area.
#[no_mangle]
pub extern "C" fn reserve(bytes: usize) -> usize {
    let base = unsafe { &__heap_base as *const u8 as usize };
    let base = (base + 15) & !15;
    let needed = base + bytes;
    let have = core::arch::wasm32::memory_size(0) * PAGE;
    if needed > have {
        let pages = (needed - have + PAGE - 1) / PAGE;
        if core::arch::wasm32::memory_grow(0, pages) == usize::MAX {
            return 0;
        }
    }
    base
}

/// Min/max peaks: for each of `buckets` equal slices of `len` samples, write
/// (min, max) pairs to `out` (2 * buckets floats).
#[no_mangle]
pub extern "C" fn peaks(input: *const f32, len: usize, buckets: usize, out: *mut f32) {
    if buckets == 0 {
        return;
    }
    let data = unsafe { slice::from_raw_parts(input, len) };
    let out = unsafe { slice::from_raw_parts_mut(out, buckets * 2) };
    for b in 0..buckets {
        let start = b * len / buckets;
        let end = ((b + 1) * len / buckets).max(start + 1).min(len);
        let mut lo = 0.0f32;
        let mut hi = 0.0f32;
        if start < end {
            lo = f32::MAX;
            hi = f32::MIN;
            for &s in &data[start..end] {
                lo = lo.min(s);
                hi = hi.max(s);
            }
        }
        out[b * 2] = lo;
        out[b * 2 + 1] = hi;
    }
}

/// Peak (absolute) level and RMS of a buffer, written to out[0], out[1].
#[no_mangle]
pub extern "C" fn levels(input: *const f32, len: usize, out: *mut f32) {
    let data = unsafe { slice::from_raw_parts(input, len) };
    let out = unsafe { slice::from_raw_parts_mut(out, 2) };
    let mut peak = 0.0f32;
    let mut sum = 0.0f64;
    for &s in data {
        let a = if s < 0.0 { -s } else { s };
        if a > peak {
            peak = a;
        }
        sum += (s as f64) * (s as f64);
    }
    out[0] = peak;
    out[1] = if len > 0 { sqrt(sum / len as f64) as f32 } else { 0.0 };
}

fn sqrt(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    // Newton iterations are plenty for a level meter.
    let mut r = x;
    for _ in 0..40 {
        r = 0.5 * (r + x / r);
    }
    r
}

/// dst[i] += src[i] * gain, where gain ramps linearly from g0 to g1 across the buffer.
#[no_mangle]
pub extern "C" fn mix_ramp(dst: *mut f32, src: *const f32, len: usize, g0: f32, g1: f32) {
    let d = unsafe { slice::from_raw_parts_mut(dst, len) };
    let s = unsafe { slice::from_raw_parts(src, len) };
    if len == 0 {
        return;
    }
    // Gain from the sample index in f64: summing an f32 step drifts audibly on long buffers.
    let step = if len > 1 { (g1 as f64 - g0 as f64) / (len as f64 - 1.0) } else { 0.0 };
    for i in 0..len {
        let g = g0 as f64 + step * i as f64;
        d[i] = (d[i] as f64 + s[i] as f64 * g) as f32;
    }
}

/// Linear-interpolation resample: reads `src` (len samples) starting at
/// fractional position `pos` with increment `step`, writes `count` samples to
/// `dst`. Reads before the start or past the end produce silence.
#[no_mangle]
pub extern "C" fn resample(src: *const f32, len: usize, pos: f64, step: f64, dst: *mut f32, count: usize) {
    let s = unsafe { slice::from_raw_parts(src, len) };
    let d = unsafe { slice::from_raw_parts_mut(dst, count) };
    let mut p = pos;
    for i in 0..count {
        if p < 0.0 {
            d[i] = 0.0;
            p += step;
            continue;
        }
        let idx = p as usize;
        let frac = (p - idx as f64) as f32;
        d[i] = if idx + 1 < len {
            s[idx] + (s[idx + 1] - s[idx]) * frac
        } else if idx < len {
            s[idx]
        } else {
            0.0
        };
        p += step;
    }
}

/// Soft clip a mixed buffer in place so summed tracks never wrap.
#[no_mangle]
pub extern "C" fn soft_clip(buf: *mut f32, len: usize) {
    let b = unsafe { slice::from_raw_parts_mut(buf, len) };
    for v in b.iter_mut() {
        let x = *v;
        if x > 0.9 {
            *v = 0.9 + 0.1 * tanh((x - 0.9) * 10.0);
        } else if x < -0.9 {
            *v = -0.9 - 0.1 * tanh((-x - 0.9) * 10.0);
        }
    }
}

fn tanh(x: f32) -> f32 {
    // Rational approximation that reaches exactly 1 with zero slope at x = 3,
    // so saturating from there keeps the curve smooth and never above 1.
    if x > 3.0 {
        return 1.0;
    }
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}
