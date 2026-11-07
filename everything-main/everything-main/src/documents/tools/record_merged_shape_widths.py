from pathlib import Path
import pypdfium2 as pdfium
import ctypes,json,hashlib
root=Path(__file__).resolve().parents[1]/'tests/fixtures/merged-shape-widths'
pages=[]
with pdfium.PdfDocument(root/'merged-shape-width-native.pdf') as doc:
 for page in doc:
  bounds=[]
  for obj in page.get_objects():
   if obj.type!=pdfium.raw.FPDF_PAGEOBJ_PATH:continue
   channels=[ctypes.c_uint() for _ in range(4)]
   pdfium.raw.FPDFPageObj_GetFillColor(obj.raw,*[ctypes.byref(c) for c in channels])
   if tuple(c.value for c in channels[:3])==(0,128,0):bounds.append(list(obj.get_bounds()))
  vertical=[b for b in bounds if b[2]-b[0]<2 and b[3]-b[1]>2]
  xs=sorted(set(round((b[0]+b[2])/2,3) for b in vertical))
  pages.append({'boundariesPt':xs,'widthsPt':[round(b-a,3) for a,b in zip(xs,xs[1:])]})
result={'referenceBuild':'16.0.20326','pages':pages,'hashes':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['merged-shape-width-control.docx','merged-shape-width-native.pdf']}}
(root/'merged-shape-width-reference.json').write_text(json.dumps(result,indent=2))
print(json.dumps(pages,indent=2))
