"""Extract independent reference raster extents from the geometry formula probe."""
from pathlib import Path
import json,hashlib
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'tests/fixtures/geometry-guide-rebinding'
pdf=pdfium.PdfDocument(folder/'native.pdf')
assert len(pdf)==1
im=pdf[0].render(scale=4).to_pil().convert('RGB')
cases=json.loads((folder/'cases.json').read_text())
for case in cases:
 y=round((case['y']+18)*4)
 xs=[x for x in range(round((case['x']-6)*4),round((case['x']+182)*4)) if sum(abs(a-b) for a,b in zip(im.getpixel((x,y)),(32,128,96)))<15]
 assert xs,case
 case['nativeLeft']=min(xs)/4;case['nativeRight']=(max(xs)+1)/4
 print(case['name'],case['nativeRight']-case['nativeLeft'])
(folder/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','sourceSha256':hashlib.sha256((ROOT/'public/fixtures'/'geometry-guide-rebinding.docx').read_bytes()).hexdigest(),'cases':cases},indent=2)+'\n',encoding='utf-8')

