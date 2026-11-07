"""Bind native PDF positions and COM margins to their original DOCX controls."""
from pathlib import Path
import hashlib, json
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/table-margin-defaults'
for source in ROOT.glob('*.docx'):
    native=source.with_suffix('.pdf'); pdf=PdfReader(native); lines=[]
    for i,page in enumerate(pdf.pages):
        def visit(text,cm,tm,font,size):
            if text.strip(): lines.append(dict(page=i,text=text.strip(),x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4],baseline=float(page.mediabox.height)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])))
        page.extract_text(visitor_text=visit)
    assert len(lines)==3
    result=json.loads(source.with_name(source.stem+'-native.json').read_text(encoding='utf-8-sig'))
    result.update(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(native.read_bytes()).hexdigest(),pages=len(pdf.pages),lines=lines)
    source.with_name(source.stem+'-reference.json').write_text(json.dumps(result,indent=2)+'\n')
