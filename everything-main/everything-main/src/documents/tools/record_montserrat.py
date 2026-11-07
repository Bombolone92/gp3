"""Record native reference text origins and ink for the independent Montserrat fixture."""
from pathlib import Path
import ctypes, hashlib, json, math, argparse
import pypdfium2 as pdfium
from pypdf import PdfReader
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fixture',default='montserrat')
parser.add_argument('--source',default='styles.docx')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]/'tests/fixtures'/args.fixture
cases=json.loads((root/'cases.json').read_text());pdf=pdfium.PdfDocument(root/'native.pdf');rows=[]
for page_index,page in enumerate(pdf):
    text=page.get_textpage()
    for index in range(text.count_chars()):
        char=text.get_text_range(index,1)
        if char in '\r\n':continue
        x,y=ctypes.c_double(),ctypes.c_double()
        pdfium.raw.FPDFText_GetCharOrigin(text,index,ctypes.byref(x),ctypes.byref(y))
        baseline=page.get_height()-y.value
        if not rows or rows[-1]['page']!=page_index or abs(rows[-1]['baseline']-baseline)>.5:
            rows.append({'page':page_index,'baseline':baseline,'x':x.value,'text':''})
        rows[-1]['text']+=char
for row in rows:row['text']=row['text'].rstrip()
assert [r['text'] for r in rows]==[c['text'] for c in cases]
scale=16/3
for page_index,page in enumerate(pdf):
    image=page.render(scale=scale).to_pil().convert('RGB')
    for row,case in zip(rows,cases):
        if row['page']!=page_index:continue
        size=case['size'];box=[math.floor(35*scale),math.floor((row['baseline']-.9*size)*scale),math.ceil(578*scale),math.ceil((row['baseline']+.3*size)*scale)]
        row['box']=box;row['ink']=sum(1-sum(pixel)/765 for pixel in image.crop(box).getdata())
fonts=sorted({str(f.get_object()['/BaseFont']).split('+')[-1] for page in PdfReader(root/'native.pdf').pages for f in page['/Resources']['/Font'].values()})
(root/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','pages':len(pdf),'fonts':fonts,'rows':rows,'sha256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in [args.source,'native.pdf','cases.json']}},indent=2)+'\n')
