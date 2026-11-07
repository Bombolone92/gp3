"""Record authored row labels and glyph bounds from native PDF; no font data."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdf
import argparse
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory',type=Path);args=parser.parse_args();root=args.directory
doc=pdf.PdfDocument(root/'native.pdf');rows=[]
for p,page in enumerate(doc):
 text=page.get_textpage()
 for i in range(text.count_chars()):
  label=text.get_text_range(i,5)
  if len(label)==5 and label[0]=='R' and label[1:].isdigit():
   boxes=[text.get_charbox(i+j) for j in range(5)]
   rows.append(dict(label=label,page=p,top=page.get_height()-max(b[3] for b in boxes),bottom=page.get_height()-min(b[1] for b in boxes)))
cases=json.loads((root/'cases.json').read_text());expected=[r['label'] for r in cases['labels']]
if [r['label'] for r in rows]!=expected:raise ValueError('Native labels differ from authored inventory')
sha=lambda name:hashlib.sha256((root/name).read_bytes()).hexdigest()
result=dict(sourceSha256=sha('exact-row-page-fit-20261004.docx'),casesSha256=sha('cases.json'),pdfSha256=sha('native.pdf'),pages=len(doc),rows=rows)
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
for case in cases['cases']:
 labels={r['label'] for r in cases['labels'] if r['case']==case['name']};group=[r for r in rows if r['label'] in labels]
 counts={p:sum(r['page']==p for r in group) for p in sorted({r['page'] for r in group})}
 print(case['name'],counts)
