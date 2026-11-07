"""Record native reference PDF positions and bind them to original control hashes. Requires pypdf."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/continuous-boundary'
rows=[]
for case in json.loads((root/'cases.json').read_text()):
    source=root/(case['name']+'.docx');pdf=source.with_suffix('.pdf');doc=PdfReader(pdf);lines=[]
    for i,page in enumerate(doc.pages):
        def visitor(text,cm,tm,font,size):
            if text.strip():lines.append(dict(page=i,text=text.strip(),x=tm[4],baseline=float(page.mediabox.height)-tm[5]))
        page.extract_text(visitor_text=visitor)
    row={**case,'pages':len(doc.pages),'lines':lines,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest()}
    rows.append(row)
    print(case['name'],[(l['page'],l['baseline']) for l in lines if l['text']=='AFTER'])
(root/'native.json').write_text(json.dumps({'referenceVersion':'16.0.20326','tolerancePt':.15,'cases':rows},indent=2)+'\n',encoding='utf8')
