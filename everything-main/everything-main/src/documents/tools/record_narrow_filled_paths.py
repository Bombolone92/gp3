"""Record independent native screen coverage and exact PDF rectangle geometry."""
from pathlib import Path
from hashlib import sha256
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image
import argparse,json
parser=argparse.ArgumentParser()
parser.add_argument('--top',type=Path,required=True)
parser.add_argument('--bottom',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]/'tests/fixtures/narrow-filled-paths'
cases=json.loads((root/'cases.json').read_text())
reader=PdfReader(root/'native.pdf');assert len(reader.pages)==1
rectangles=[list(map(float,v)) for v,op in ContentStream(reader.pages[0].get_contents(),reader).operations if op==b're']
screens=[Image.open(args.top).convert('RGB'),Image.open(args.bottom).convert('RGB')]
for case in cases:
 expected=[case['xPt']+10,792-case['yPt']-case['thicknessPt'],45,case['thicknessPt']]
 candidate=min(rectangles,key=lambda v:sum(abs(a-b) for a,b in zip(v,expected)))
 assert max(abs(a-b) for a,b in zip(candidate,expected))<.001,(case,candidate)
 case['nativePdfRectanglePt']=candidate
 bottom=case['panel']==3
 image=screens[int(bottom)];originY=-141 if bottom else 195
 x=round(223+(case['xPt']+30)*4/3);y=round(originY+case['yPt']*4/3)
 background=image.getpixel((x,y-5))[0]
 denominator=255-background if case['color']=='FFFFFF' else background
 sign=1 if case['color']=='FFFFFF' else -1
 coverage=[sign*(image.getpixel((x,j))[0]-background)/denominator for j in range(y-2,y+8)]
 case['nativeScreenCoveragePx']=sum(coverage)
 case['nativeScreenPeak']=max(coverage)
data={'referenceVersion':'16.0.20326','sourceSha256':sha256((root/'control.docx').read_bytes()).hexdigest(),
 'pdfSha256':sha256((root/'native.pdf').read_bytes()).hexdigest(),
 'screenEvidence':[{'privateFilename':p.name,'sha256':sha256(p.read_bytes()).hexdigest()} for p in [args.top,args.bottom]],
 'screenProtocol':{'zoomPercent':100,'pixelsPerPoint':4/3,'pageOriginX':223,'topPageOriginY':195,'bottomPageOriginY':-141,'sampleLocalXPt':30,'rowRange':[-2,8],
 'description':'Screen positions calibrated against observed 816px page width and panel edges. Red-channel ink normalized against the local background and declared white/black foreground. Only horizontal-strip coverage is numerically compared; diagonal strips are visual controls.'},'cases':cases}
(root/'reference.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
