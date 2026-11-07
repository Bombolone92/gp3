"""Record native text origins and visible tall picture bounds from reference exports."""
from pathlib import Path
import hashlib,json
from pypdf import PdfReader
import pypdfium2 as pdfium
import numpy as np
root=Path(__file__).resolve().parents[1]/'tests/fixtures/oversized-body-lines'
records={}
for source in sorted(root.glob('*.docx')):
 pdf=source.with_name(source.stem+'-native.pdf')
 if not pdf.exists():continue
 raster=pdfium.PdfDocument(pdf);pages=[]
 for i,page in enumerate(PdfReader(pdf).pages):
  text=[];pictures=[];height=float(page.mediabox.height)
  def visit_text(value,cm,tm,font,size):
   if value.strip():text.append({'text':value.strip(),'x':tm[4]*cm[0]+tm[5]*cm[2]+cm[4],'baseline':height-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])})
  def visit_op(op,args,cm,tm):
   if op==b'Do':pictures.append({'x':cm[4],'y':height-cm[5]-cm[3],'width':cm[0],'height':cm[3]})
  page.extract_text(visitor_text=visit_text,visitor_operand_before=visit_op)
  image=np.asarray(raster[i].render(scale=2).to_pil().convert('RGB')).astype('int16')
  mask=((image[:,:,0]<100)&(image[:,:,1]<160)&(image[:,:,2]>120))|((image[:,:,0]>180)&(image[:,:,1]>50)&(image[:,:,1]<160)&(image[:,:,2]<100))
  ys,xs=np.nonzero(mask)
  bounds=[float(xs.min()/2),float(ys.min()/2),float((xs.max()+1)/2),float((ys.max()+1)/2)] if pictures and len(xs) else None
  pages.append({'text':text,'pictures':pictures,'visiblePictureBounds':bounds})
 records[source.stem]={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'pages':pages}
(root/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','records':records},indent=2)+'\n')
for name,record in records.items():print(name,json.dumps(record['pages']))
