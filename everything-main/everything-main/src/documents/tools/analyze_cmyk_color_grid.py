"""Reconstruct native palette observations and evaluate a rejected interpolation."""
from pathlib import Path
import struct,json,itertools,argparse
import numpy as np
from zipfile import ZipFile
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/cmyk-color-grid')
root=parser.parse_args().root;cases=json.loads((root/'cases.json').read_text());sets={'grid':[],'holdout':[]};bitdepths={}
with ZipFile(root/'native-metafiles.zip') as archive:
 captures={name:archive.read(name) for name in archive.namelist()}
for index,case in enumerate(cases,1):
 data=captures[f'{index}.emf'];p=0;found=[]
 while p<len(data):
  k,n=struct.unpack_from('<II',data,p)
  if k==81:
   off,cb,bo,bs=struct.unpack_from('<4I',data,p+48);header=data[p+off:p+off+cb]
   hs,w,h,planes,bpp,compression,_,_,_,used,_=struct.unpack_from('<IiiHHIIiiII',header)
   assert (hs,planes,compression)==(40,1,0) and (w,h) in [(256,128),(512,256)] and bpp in [1,4,8],(index,w,h,bpp)
   cols,cellw=(4,64) if w==256 else (16,32)
   palette=[list(reversed(header[40+4*i:43+4*i])) for i in range(used)];bits=data[p+bo:p+bo+bs]
   stride=((w*bpp+31)//32)*4
   def pixel(i):
    x=i%cols*cellw+cellw//2;y=h-1-(i//cols*32+16);byte=bits[y*stride+x*bpp//8];return palette[(byte>>(8-bpp-(x*bpp%8)))&((1<<bpp)-1)]
   found.append([pixel(i) for i in range(len(case['colors']))]);bitdepths[index]=bpp
  p+=n
 assert len(found)==1
 for c,rgb in zip(case['colors'],found[0]):sets[case['set']].append({'cmyk':c,'rgb':rgb})
levels=np.array(sorted({s['cmyk'][0] for s in sets['grid']}));size=len(levels)
assert [s['cmyk'] for s in sets['grid']]==[list(c) for c in itertools.product(levels.tolist(),repeat=4)]
grid=np.array([s['rgb'] for s in sets['grid']]).reshape(size,size,size,size,3);results=[]
for sample in sets['holdout']:
 c=np.array(sample['cmyk']);lo=np.minimum(np.searchsorted(levels,c,side='right')-1,size-2);fraction=(c-levels[lo])/(levels[lo+1]-levels[lo]);prediction=np.zeros(3)
 for mask in itertools.product([0,1],repeat=4):
  prediction+=grid[tuple(lo+mask)]*np.prod(np.where(mask,fraction,1-fraction))
 prediction=np.rint(prediction).astype(int);native=np.array(sample['rgb']);naive=np.rint(255*(1-c[:3]/255)*(1-c[3]/255)).astype(int)
 results.append({**sample,'interpolated':prediction.tolist(),'interpolationError':int(abs(prediction-native).max()),'naiveError':int(abs(naive-native).max())})
report={'samples':sets,'holdoutResults':results,'bitDepths':bitdepths,'maxInterpolationError':max(s['interpolationError'] for s in results),'meanInterpolationError':sum(s['interpolationError'] for s in results)/len(results),'maxNaiveError':max(s['naiveError'] for s in results),'worseThanNaive':sum(s['interpolationError']>s['naiveError'] for s in results)}
(root/'candidate-analysis.json').write_text(json.dumps(report,indent=2)+'\n')
print({k:v for k,v in report.items() if k not in ['samples','holdoutResults','bitDepths']})
