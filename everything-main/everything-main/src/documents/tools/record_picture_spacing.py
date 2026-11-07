"""Record the reference's following-text origins and inline picture extents."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json,re
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/picture-spacing'
source=root/'public/fixtures/picture-spacing.docx';pdf=folder/'native.pdf'
pages=PdfReader(pdf).pages;assert len(pages)==1
stream=pages[0].get_contents().get_data().decode('latin1')
origins=[]
for block in re.findall(r'BT(.*?)ET',stream,re.S):
 match=re.search(r'1 0 0 1 ([\d.]+) ([\d.]+) Tm.*?\[\(NE\)3\(XT\)3\((\d)\)\] TJ',block,re.S)
 if match:origins.append(match.groups())
frames=re.findall(r'([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s+/Image\d+ Do',stream)
assert len(origins)==len(frames)==5
cases=[]
for spacing,(x,y,i),frame in zip([0,10,-10,50,-50],origins,frames):
 w,h,left,bottom=map(float,frame)
 cases.append(dict(id='NEXT'+i,spacing=spacing,x=float(x),baseline=792-float(y),image=dict(x=left,y=792-bottom-h,width=w,height=h)))
assert all(c['x']==180.05 and c['image']['width']==144 for c in cases)
data=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',cases=cases)
(folder/'reference.json').write_text(json.dumps(data,indent=2)+'\n')
