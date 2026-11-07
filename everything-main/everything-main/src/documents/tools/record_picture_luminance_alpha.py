"""Record the native full-alpha image bytes, independently of renderer code."""
from pathlib import Path
from pypdf import PdfReader
import json,re,hashlib

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/picture-luminance-alpha'
cases=json.loads((folder/'cases.json').read_text());reader=PdfReader(folder/'native.pdf');rows=[]
for page_index,page in enumerate(reader.pages):
    for name in re.findall(r'/([^\s]+) Do',page.get_contents().get_data().decode('latin1')):
        image=page['/Resources']['/XObject']['/'+name].get_object()
        if image.get('/Subtype')!='/Image':continue
        assert (int(image['/Width']),int(image['/Height']))==(256,16)
        assert image['/ColorSpace']=='/DeviceRGB' and image['/BitsPerComponent']==8
        raw=image.get_data();mask=image['/SMask'].get_object();alpha=mask.get_data()
        assert len(raw)==256*16*3 and len(alpha)==256*16
        samples=[[*raw[(8*256+x)*3:(8*256+x)*3+3],alpha[8*256+x]] for x in range(256)]
        assert [s[3] for s in samples]==list(range(256))
        rows.append(dict(case=cases['cases'][len(rows)]['label'],page=page_index,
            matte=list(mask.get('/Matte',[])),samples=samples))
assert len(rows)==len(cases['cases'])
result=dict(referenceVersion='16.0.20326',pages=len(reader.pages),
    sampleFormat='PDF image R,G,B and soft-mask alpha; not straight RGBA or composited page RGB',
    rows=rows,sha256={n:hashlib.sha256((folder/n).read_bytes()).hexdigest() for n in ['control.docx','cases.json','native.pdf']})
(folder/'reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf8')
