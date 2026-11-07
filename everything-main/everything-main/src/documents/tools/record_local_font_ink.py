"""Record native ink for the existing independently authored exact-face control."""
from pathlib import Path
import hashlib,json,math,argparse
from pypdf import PdfReader
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--weights',action='store_true');args=parser.parse_args()
folder=root/'tests/fixtures/synthetic-bold'
source=folder/'weights.docx' if args.weights else root/'public/fixtures/synthetic-bold.docx'
pdfpath=folder/('weights-native.pdf' if args.weights else 'native.pdf')
reader=PdfReader(pdfpath);pdf=pdfium.PdfDocument(pdfpath);lines=[];scale=16/3
for page_index,page in enumerate(reader.pages):
    image=pdf[page_index].render(scale=scale).to_pil().convert('RGB')
    spans=[]
    def visit(text,cm,tm,font,size):
        if text.strip():spans.append(dict(text=text.strip(),baseline=float(page.mediabox.height)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5]),size=float(size)))
    page.extract_text(visitor_text=visit)
    assert len(spans)==(8 if args.weights else 12)
    for line in spans:
        box=[math.floor((32 if args.weights else 68)*scale),math.floor((line['baseline']-line['size']*.95)*scale),math.ceil((580 if args.weights else 548)*scale),math.ceil((line['baseline']+line['size']*.35)*scale)]
        lines.append(dict(**line,page=page_index,box=box,ink=sum(1-sum(p)/765 for p in image.crop(box).getdata())))
result=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdfpath.read_bytes()).hexdigest(),dpi=384,lines=lines)
(folder/('weights-ink.json' if args.weights else 'metadata-ink.json')).write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
