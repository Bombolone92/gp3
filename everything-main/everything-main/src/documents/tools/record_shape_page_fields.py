"""Record native displayed field strings independently of app resolution."""
from pathlib import Path
from pypdf import PdfReader
import hashlib, json, re, sys
root = Path(__file__).resolve().parents[1]
name=sys.argv[1] if len(sys.argv)>1 else 'shape-page-fields'
folder = root/'tests/fixtures'/name
source = root/'public/fixtures'/(name+'.docx')
pdf = folder/'native.pdf'
pages = []
sizes = []
for page in PdfReader(pdf).pages:
    fields = re.findall(r'F([0-7]):\s*([0-9ivxIVX]+)', page.extract_text())
    assert len(fields) == 8
    pages.append({f'F{i}': value for i,value in fields})
    runs=[]
    page.extract_text(visitor_text=lambda text,cm,tm,font,size: runs.append((text.strip(),size)) if text.strip() else None)
    sizes.append({text.split(':')[0]:runs[i+1][1] for i,(text,size) in enumerate(runs) if re.fullmatch(r'F[0-7]:',text)})
(folder/'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',pages=pages,sizes=sizes),indent=2)+'\n')
print(pages)
