"""Record native PDF image/mask bytes separately from composited page colors."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import json, re, hashlib

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/picture-luminance-neutral'
data=json.loads((folder/'cases.json').read_text())
reader=PdfReader(folder/'native.pdf'); rendered=pdfium.PdfDocument(folder/'native.pdf')
rows=[]
for page_index,page in enumerate(reader.pages):
    raster=rendered[page_index].render(scale=4).to_pil().convert('RGB')
    placements=re.findall(r'([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s+/([^\s]+) Do',page.get_contents().get_data().decode('latin1'))
    for width,height,x,y,name in placements:
        width,height,x,y=map(float,(width,height,x,y)); top=float(page.mediabox.height)-y-height
        obj=page['/Resources']['/XObject']['/'+name].get_object()
        assert obj['/ColorSpace']=='/DeviceRGB' and obj['/BitsPerComponent']==8
        iw,ih=int(obj['/Width']),int(obj['/Height']); raw=obj.get_data()
        mask=obj['/SMask'].get_object(); alpha=mask.get_data()
        assert len(raw)==iw*ih*3 and len(alpha)==iw*ih
        samples=[]
        for j in range(16):
            pixel=ih//2*iw+int(iw*(j+.5)/16)
            samples.append(dict(imageRGB=list(raw[pixel*3:pixel*3+3]),alpha=alpha[pixel],
                pageRGB=list(raster.getpixel((round((x+width*(j+.5)/16)*4),round((top+height/2)*4))))))
        rows.append(dict(case=data['cases'][len(rows)]['label'],page=page_index,matte=list(mask.get('/Matte',[])),samples=samples))
assert len(rows)==len(data['cases'])
reference=dict(referenceVersion='16.0.20326',pages=len(reader.pages),rows=rows,
    sha256={n:hashlib.sha256((folder/n).read_bytes()).hexdigest() for n in ['control.docx','cases.json','native.pdf']})
(folder/'reference.json').write_text(json.dumps(reference,indent=2)+'\n',encoding='utf8')
