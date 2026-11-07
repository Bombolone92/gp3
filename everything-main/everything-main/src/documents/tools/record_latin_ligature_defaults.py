"""Record native results for the original ligature controls without redistributing fonts."""
import argparse, hashlib, json
from pathlib import Path
from pypdf import PdfReader
p=argparse.ArgumentParser();p.add_argument('pdf_directory',type=Path);a=p.parse_args()
root=Path(__file__).resolve().parents[1];fixture=root/'tests/fixtures/latin-ligature-defaults';cases=json.loads((fixture/'cases.json').read_text());out=[]
for enabled in [0,1]:
 pdf=a.pdf_directory/f'ligature-defaults-native-{enabled}.pdf';rows=[]
 def visit(text,cm,tm,font,size):
  if text.strip():rows.append({'text':text.strip(),'xPt':tm[4],'yPt':tm[5],'pdfSizePt':size})
 reader=PdfReader(pdf)
 for page in reader.pages:page.extract_text(visitor_text=visit)
 assert len(rows)==len(cases)
 for row,case in zip(rows,cases):
  assert row['text']==case['text'];row['mode']=case['mode']
 out.append({'enableOpenTypeFeatures':enabled,'referenceVersion':'16.0.20326','pages':len(reader.pages),'sourceSha256':hashlib.sha256((fixture/f'control-{enabled}.docx').read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'rows':rows})
(fixture/'reference.json').write_text(json.dumps(out,indent=2)+'\n')
