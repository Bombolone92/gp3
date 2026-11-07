"""Extract page assignments directly from original reference exports."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/terminal-break-fit'
result=[]
for pdf in sorted(folder.glob('*.pdf')):
    source=root/f'public/fixtures/terminal-break-{pdf.stem}.docx'
    doc=pdfium.PdfDocument(pdf);texts=[doc[i].get_textpage().get_text_range() for i in range(len(doc))]
    after=[i for i,t in enumerate(texts) if 'After' in t]
    assert len(after)==1
    result.append(dict(name=pdf.stem,pages=len(doc),afterPage=after[0],sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest()))
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
