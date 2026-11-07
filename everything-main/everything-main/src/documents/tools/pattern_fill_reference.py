"""Measure native output of original pattern controls; no engine code reused."""
from pathlib import Path
import hashlib,json
from pypdf import PdfReader,PdfWriter
from pypdf.generic import FloatObject
from io import BytesIO
import pypdfium2 as pdf
from pypdfium2.raw import FPDF_PAGEOBJ_PATH

ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/pattern-fills'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
cases=json.loads((ROOT/'cases.json').read_text())
reader=PdfReader(ROOT/'controls-native.pdf');raster=pdf.PdfDocument(ROOT/'controls-native.pdf')
assert len(reader.pages)==len(cases)==74
pages=[]
for i,(case,page) in enumerate(zip(cases,reader.pages)):
 patterns=page['/Resources'].get('/Pattern',{})
 assert len(patterns)==1,(i,patterns)
 pattern=next(iter(patterns.values())).get_object()
 images=list(page.images);assert len(images)==1,(i,len(images))
 image=images[0].image.convert('RGBA');assert image.size==(16,16)
 palette=sorted({image.getpixel((x,y)) for y in range(16) for x in range(16)})
 assert 2<=len(palette)<=3,(i,palette)
 rows=[]
 for y in range(8):
  row=[]
  for x in range(8):
   color=image.getpixel((2*x,2*y))
   assert all(image.getpixel((2*x+dx,2*y+dy))==color for dx in range(2) for dy in range(2)),(i,x,y)
   row.append(str(palette.index(color)))
  rows.append(''.join(row))
 native=raster[i]
 bounds=[list(obj.get_bounds()) for obj in native.get_objects(filter=[FPDF_PAGEOBJ_PATH])]
 rgb=native.render(scale=2).to_pil().convert('RGB')
 sample=native.render(scale=4/3).to_pil().convert('RGB').crop((232,192,240,200))
 record=dict(**case,palette=palette,rows=rows,matrix=list(pattern['/Matrix']),tileBounds=list(pattern['/BBox']),xStep=pattern['/XStep'],yStep=pattern['/YStep'],shapeBounds=bounds,rgb144Sha256=hashlib.sha256(rgb.tobytes()).hexdigest(),sample96=sample.tobytes().hex())
 if case.get('rotation') or case.get('groupRotation'):
  # PDFium changes tile raster dimensions for the native sub-micropoint skew.
  # Preserve the original samples, plus an explicitly separate diagnostic
  # with only the near-zero off-diagonal tile coefficients set to zero.
  writer=PdfWriter();writer.add_page(page)
  for item in writer.pages[0]['/Resources']['/Pattern'].values():
   matrix=item.get_object()['/Matrix']
   for axis in [1,2]:
    assert abs(float(matrix[axis]))<1e-7;matrix[axis]=FloatObject(0)
  stream=BytesIO();writer.write(stream);normalized=pdf.PdfDocument(stream.getvalue())
  record['axisAlignedSample96']=normalized[0].render(scale=4/3).to_pil().convert('RGB').crop((232,192,240,200)).tobytes().hex()
 pages.append(record)
result=dict(referenceVersion='16.0.20326',sourceSha256=sha(ROOT/'controls.docx'),pdfSha256=sha(ROOT/'controls-native.pdf'),pages=pages)
(ROOT/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print(f'Verified {len(pages)} native pattern tiles and recorded transforms, colors and clipping bounds')
