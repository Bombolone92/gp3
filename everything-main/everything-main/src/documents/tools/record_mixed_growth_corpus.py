"""Record native monthly-column origins from the local corpus reference PDF."""
from pathlib import Path
from pypdf import PdfReader
import argparse,hashlib,json
p=argparse.ArgumentParser(description=__doc__);p.add_argument('docx',type=Path);p.add_argument('pdf',type=Path);args=p.parse_args()
reader=PdfReader(args.pdf);assert len(reader.pages)==18
page=reader.pages[13];height=float(page.mediabox.height);points=[]
labels={'JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC','YTD'}
def visit(text,cm,tm,font,size):
    if text.strip() in labels:
        points.append(dict(text=text.strip(),x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4],y=height-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])))
page.extract_text(visitor_text=visit);assert len(points)==26
reference=dict(source=args.docx.parent.name+'/'+args.docx.name,sourceSha256=hashlib.sha256(args.docx.read_bytes()).hexdigest(),nativePdfSha256=hashlib.sha256(args.pdf.read_bytes()).hexdigest(),native='Retained native reference PDF; page 14 text matrices extracted with pypdf. The original source and PDF stay local.',pageIndex=13,totalPages=18,tolerancePt=.2,points=points)
out=Path(__file__).resolve().parents[1]/'tests/fixtures/mixed-growth-preference/corpus-reference.json';out.write_text(json.dumps(reference,indent=2)+'\n')
