"""Diagnostic only: original Lab ICC from native control observations, not a renderer profile.

Run analyze_cmyk_color_grid.py --root tests/fixtures/cmyk-color-fine first.
ICC lut16Type follows https://www.color.org/specification/ICC.1-2001-04.pdf.
No proprietary profile or table is read. Outputs go to the explicitly chosen directory.
"""
from pathlib import Path
import json,struct
import numpy as np
from PIL import ImageCms
from io import BytesIO
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--analysis',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args();p=args.output;p.mkdir(parents=True,exist_ok=True)
r=json.loads(args.analysis.read_text());assert len(r['samples']['grid'])==17**4
rgb=np.array([s['rgb'] for s in r['samples']['grid']],dtype=float)/255
lin=np.where(rgb<=0.04045,rgb/12.92,((rgb+0.055)/1.055)**2.4)
xyz=lin@np.array([[.4360747,.3850649,.1430804],[.2225045,.7168786,.0606169],[.0139322,.0971045,.7141733]]).T
f=np.where(xyz/np.array([.9642,1,.8249])>(6/29)**3,np.cbrt(xyz/np.array([.9642,1,.8249])),(xyz/np.array([.9642,1,.8249]))/(3*(6/29)**2)+4/29)
lab=np.stack([(116*f[:,1]-16)/100,(500*(f[:,0]-f[:,1])+128)/255,(200*(f[:,1]-f[:,2])+128)/255],axis=1)
be=lambda *v:struct.pack('>'+'I'*len(v),*v)
fixed=lambda x:int(round(x*65536))
identity=b''.join(be(fixed(float(i%4==0))) for i in range(9))
curve=np.array([round(((v/16 if v<240 else 15+(v-240)/15)/16)*65535) for v in range(256)],dtype='>u2').tobytes()
lut=b'mft2'+bytes(4)+bytes([4,3,17,0])+identity+struct.pack('>HH',256,2)+curve*4+np.clip(np.rint(lab*65280),0,65535).astype('>u2').tobytes()+struct.pack('>HH',0,65535)*3
name=b'Original Word observations CMYK diagnostic\0'
desc=b'desc'+bytes(4)+be(len(name))+name+bytes(8)+bytes(70)
tags={b'desc':desc,b'cprt':b'text'+bytes(4)+b'Original project calibration observations.\0',b'wtpt':b'XYZ '+bytes(4)+be(fixed(.9642),fixed(1),fixed(.8249)),b'A2B0':lut}
header=bytearray(128);header[8:12]=bytes([2,0x10,0,0]);header[12:24]=b'scnrCMYKLab ';header[24:36]=struct.pack('>6H',2026,9,27,0,0,0);header[36:40]=b'acsp';header[68:80]=be(fixed(.9642),fixed(1),fixed(.8249))
offset=128+4+12*len(tags);table=be(len(tags));body=b''
for key,value in tags.items():
 table+=key+be(offset,len(value));pad=value+bytes((-len(value))%4);body+=pad;offset+=len(pad)
header[:4]=be(offset);profile=bytes(header)+table+body
(p/'original-diagnostic.icc').write_bytes(profile)
print(ImageCms.getProfileName(ImageCms.ImageCmsProfile(BytesIO(profile))),len(profile))
# Replace only ICC APP2 segments; preserve all entropy-coded JPEG data.
def inject(data):
 out=data[:2];pos=2
 while pos<len(data):
  assert data[pos]==255
  marker=data[pos+1]
  if marker==218:out+=data[pos:];break
  size=int.from_bytes(data[pos+2:pos+4],'big');segment=data[pos:pos+2+size]
  if not(marker==226 and segment[4:16]==b'ICC_PROFILE\0'):out+=segment
  pos+=2+size
 chunks=[profile[i:i+65000] for i in range(0,len(profile),65000)]
 app=b''.join(b'\xff\xe2'+struct.pack('>H',16+len(chunk))+b'ICC_PROFILE\0'+bytes([i+1,len(chunks)])+chunk for i,chunk in enumerate(chunks))
 return out[:2]+app+out[2:]
repo=Path(__file__).resolve().parents[1]
(p/'profile-control.jpg').write_bytes(inject((repo/'tests/fixtures/cmyk-jpeg/device-cmyk.jpg').read_bytes()))
