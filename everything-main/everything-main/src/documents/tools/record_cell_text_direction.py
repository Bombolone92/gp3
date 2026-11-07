"""Record native text matrices without flattening rotated coordinates."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import json,hashlib,sys
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/cell-text-direction'
name=sys.argv[1] if len(sys.argv)>1 else 'control'
pages=[]
native = pdfium.PdfDocument(folder/(name+'-native.pdf'))
for index,page in enumerate(PdfReader(folder/(name+'-native.pdf')).pages):
 runs=[]
 def visit(text,cm,tm,font,size):
  if text.strip():runs.append(dict(text=text,cm=cm,tm=tm,font=str(font.get('/BaseFont')) if font else None,size=size))
 page.extract_text(visitor_text=visit)
 # Retain vector bounds as evidence for row allocation independently of text
 # matrices: clipped rotated text can extend far beyond the visible cell.
 paths=[list(obj.get_bounds()) for obj in native[index].get_objects()
        if obj.type == pdfium.raw.FPDF_PAGEOBJ_PATH]
 pages.append(dict(width=float(page.mediabox.width),height=float(page.mediabox.height),runs=runs,pathBounds=paths))
result=dict(pages=pages,hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [folder/(name+'.docx'),folder/(name+'-native.pdf')]})
(folder/('reference.json' if name=='control' else name+'-reference.json')).write_text(json.dumps(result,indent=2)+'\n')
