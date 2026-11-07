"""Record independent reference glyph baselines and source/PDF hashes."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/text-space-metrics'
for name in ['mode14','mode15','mixed-drawings','decorations']:
 pages=[]
 for page in PdfReader(folder/(name+'-native.pdf')).pages:
  baselines={}
  def visit(text,cm,tm,font,size):
   for key in ['Before','After','First','Last','Website']:
    if key in text:baselines[key]=float(page.mediabox.height)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])
  page.extract_text(visitor_text=visit);assert 'After' in baselines and 'Before' in baselines;pages.append(baselines)
 result=dict(referenceVersion='16.0.20326',pages=pages,sourceSha256=hashlib.sha256((folder/(name+'.docx')).read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/(name+'-native.pdf')).read_bytes()).hexdigest())
 (folder/(name+'-reference.json')).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
