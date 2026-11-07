"""Extract printed glyph baselines from the native reference PDF; capture hashes tie evidence to source."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/manual-break-metrics'
for mode in [14,15]:
 name=f'mode{mode}';pages=[]
 for page in PdfReader(folder/(name+'-native.pdf')).pages:
  baselines={}
  def visit(text,cm,tm,font,size):
   if text.strip() in ['First','Second','After']:
    baselines[text.strip()]=float(page.mediabox.height)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])
  page.extract_text(visitor_text=visit);assert 'After' in baselines;pages.append(baselines)
 result=dict(referenceVersion='16.0.20326',pages=pages,sourceSha256=hashlib.sha256((folder/(name+'.docx')).read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/(name+'-native.pdf')).read_bytes()).hexdigest())
 (folder/(name+'-reference.json')).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
name='page-break-large-space'
pages=[]
for page in PdfReader(folder/(name+'-native.pdf')).pages:
 pages.append(page.extract_text().strip())
(folder/(name+'-reference.json')).write_text(json.dumps(dict(pages=pages,sourceSha256=hashlib.sha256((folder/(name+'.docx')).read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/(name+'-native.pdf')).read_bytes()).hexdigest()),indent=2)+'\n',encoding='utf-8')
