use std::slice;
#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 { let mut v = vec![0u8; len].into_boxed_slice(); let p = v.as_mut_ptr(); std::mem::forget(v); p }
#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub unsafe extern "C" fn free(ptr: *mut u8, len: usize) { drop(Box::from_raw(slice::from_raw_parts_mut(ptr, len))); }
#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub unsafe extern "C" fn histogram(ptr: *const u8, len: usize, out: *mut u32) {
 let data=slice::from_raw_parts(ptr,len); let bins=slice::from_raw_parts_mut(out,256); bins.fill(0);
 for p in data.chunks_exact(4) { if p[3]>0 { let l=(p[0] as u32*54+p[1] as u32*183+p[2] as u32*19)/256; bins[l as usize]+=1; } }
}
pub fn flood(data: &[u8], w: usize, h: usize, x: usize, y: usize, tolerance: u8) -> Vec<u8> {
 let mut out=vec![0u8;w*h*4]; if x>=w||y>=h{return out;} let seed=&data[(y*w+x)*4..(y*w+x)*4+4];
 let mut visited=vec![false;w*h]; let mut queue=vec![y*w+x]; visited[y*w+x]=true;
 while let Some(i)=queue.pop() {
  let p=&data[i*4..i*4+4]; if (0..4).any(|c|p[c].abs_diff(seed[c])>tolerance){continue;}
  out[i*4..i*4+4].copy_from_slice(&[255,255,255,255]);
  let px=i%w;let py=i/w;
  for n in [if px>0{Some(i-1)}else{None},if px+1<w{Some(i+1)}else{None},if py>0{Some(i-w)}else{None},if py+1<h{Some(i+w)}else{None}].into_iter().flatten(){if !visited[n]{visited[n]=true;queue.push(n);}}
 } out
}
#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub unsafe extern "C" fn flood_fill(ptr:*const u8,w:usize,h:usize,x:usize,y:usize,tolerance:u8,out:*mut u8){let mask=flood(slice::from_raw_parts(ptr,w*h*4),w,h,x,y,tolerance);slice::from_raw_parts_mut(out,mask.len()).copy_from_slice(&mask);}
#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub unsafe extern "C" fn encode_png(ptr:*const u8,w:u32,h:u32,out_len:*mut u32)->*mut u8 {
 let mut result=Vec::new();{let mut enc=png::Encoder::new(&mut result,w,h);enc.set_color(png::ColorType::Rgba);enc.set_depth(png::BitDepth::Eight);enc.set_compression(png::Compression::Fast);let mut writer=enc.write_header().unwrap();writer.write_image_data(slice::from_raw_parts(ptr,(w*h*4)as usize)).unwrap();writer.finish().unwrap();}
 *out_len=result.len() as u32;let p=alloc(result.len());slice::from_raw_parts_mut(p,result.len()).copy_from_slice(&result);p
}
#[cfg(test)] mod tests { use super::*;
 #[test] fn fill_stops_at_boundary(){let d=[255,0,0,255,0,0,0,255,255,0,0,255];let m=flood(&d,3,1,0,0,0);assert_eq!(m[3],255);assert_eq!(m[7],0);assert_eq!(m[11],0);}
 #[test] fn tolerance_and_alpha(){let d=[10,10,10,255,12,10,10,255,12,10,10,0];let m=flood(&d,3,1,0,0,3);assert_eq!(m[7],255);assert_eq!(m[11],0);}
}
