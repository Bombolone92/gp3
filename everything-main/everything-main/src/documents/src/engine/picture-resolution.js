// Original bounded readers for PNG pHYs and JPEG JFIF/Exif resolution metadata.
// Pixel decoding remains in the browser; only physical tile sizing uses this.
export function pictureResolution(bytes) {
  const fallback = { x: 96, y: 96 };
  if (!(bytes instanceof Uint8Array)) return fallback;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const valid = p => p && Number.isFinite(p.x) && p.x > 0 && Number.isFinite(p.y) && p.y > 0;
  if (bytes.length >= 8 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) {
    for (let at=8; at+12<=bytes.length;) {
      const size=v.getUint32(at); if(size>bytes.length-at-12) break;
      if(v.getUint32(at+4)===0x70485973 && size===9 && bytes[at+16]===1) {
        const p={x:v.getUint32(at+8)*.0254,y:v.getUint32(at+12)*.0254};return valid(p)?p:fallback;
      }
      at+=size+12;
    }
  } else if(bytes.length>=4 && v.getUint16(0)===0xffd8) {
    let jfif,exif;
    for(let at=2;at+4<=bytes.length;) {
      if(bytes[at++]!==255)break;
      while(bytes[at]===255)at++;
      const marker=bytes[at++];if(marker===0xda||marker===0xd9)break;
      if(marker===1||marker>=0xd0&&marker<=0xd7)continue;
      if(at+2>bytes.length)break;
      const size=v.getUint16(at),end=at+size;if(size<2||end>bytes.length)break;
      if(marker===0xe0 && size>=16 && v.getUint32(at+2)===0x4a464946 && bytes[at+6]===0) {
        const unit=bytes[at+9],factor=unit===1?1:unit===2?2.54:0;
        const p={x:v.getUint16(at+10)*factor,y:v.getUint16(at+12)*factor};if(valid(p))jfif=p;
      }
      if(marker===0xe1 && size>=16 && v.getUint32(at+2)===0x45786966 && v.getUint16(at+6)===0) {
        const base=at+8,order=v.getUint16(base),little=order===0x4949;
        if((little||order===0x4d4d)&&v.getUint16(base+2,little)===42) {
          const ifd=base+v.getUint32(base+4,little);let x,y,unit=2;
          if(ifd>=base+8&&ifd+2<=end) {
            const count=v.getUint16(ifd,little);
            for(let i=0;i<count&&ifd+2+(i+1)*12<=end;i++) {
              const entry=ifd+2+i*12,tag=v.getUint16(entry,little),type=v.getUint16(entry+2,little),n=v.getUint32(entry+4,little);
              if(n!==1)continue;
              if(tag===296&&type===3)unit=v.getUint16(entry+8,little);
              if((tag===282||tag===283)&&type===5) {
                const ptr=base+v.getUint32(entry+8,little);
                if(ptr<base||ptr+8>end)continue;
                const value=v.getUint32(ptr,little)/v.getUint32(ptr+4,little);
                if(tag===282)x=value;else y=value;
              }
            }
            const factor=unit===2?1:unit===3?2.54:0,p={x:x*factor,y:y*factor};if(valid(p))exif=p;
          }
        }
      }
      at=end;
    }
    return exif||jfif||fallback;
  }
  return fallback;
}
