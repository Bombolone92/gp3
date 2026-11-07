"""Record independent reference cell-fill geometry for mixed preference controls."""
from pathlib import Path
from hashlib import sha256
import ctypes,json,sys
import pypdfium2 as pdf
folder=Path(__file__).resolve().parents[1]/(sys.argv[1] if len(sys.argv)>1 else 'tests/fixtures/mixed-cell-width-preferences')
source=sys.argv[2] if len(sys.argv)>2 else 'control.docx'
pdf_name=sys.argv[3] if len(sys.argv)>3 else 'native.pdf'
output=sys.argv[4] if len(sys.argv)>4 else 'reference.json'
cases=json.loads((folder/'cases.json').read_text());doc=pdf.PdfDocument(folder/pdf_name);assert len(doc)==len(cases)
colors={(153,204,255):0,(255,204,153):1,(204,255,153):2,(204,153,255):3};pages=[]
for page in doc:
 cells={}
 for obj in page.get_objects():
  if obj.type!=pdf.raw.FPDF_PAGEOBJ_PATH:continue
  ch=[ctypes.c_uint()for _ in range(4)];pdf.raw.FPDFPageObj_GetFillColor(obj.raw,*[ctypes.byref(c)for c in ch]);col=colors.get(tuple(c.value for c in ch[:3]))
  if col is None:continue
  left,bottom,right,top=obj.get_bounds();width=right-left
  if col not in cells or width>cells[col]['width']:cells[col]=dict(x=left,width=width)
 assert len(cells)==len(cases[len(pages)]['grid']);pages.append([cells[i]for i in range(len(cells))])
out=dict(referenceVersion='16.0.20326',hashes={name:sha256((folder/name).read_bytes()).hexdigest()for name in [source,'cases.json',pdf_name]},cases=cases,pages=pages)
(folder/output).write_text(json.dumps(out,indent=2)+'\n')
