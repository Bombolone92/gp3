"""Record native visible marker ink, including clipped-away PDF text."""
from pathlib import Path
import hashlib,json,math,sys
import pypdfium2 as pdf
ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/merged-ending-rows'
for mode in [14,15]:
 source=ROOT/f'controls-{mode}.docx';native=ROOT/f'native-{mode}.pdf'
 doc=pdf.PdfDocument(native);cases=json.loads(source.with_suffix('.json').read_text())
 pages=[]
 for i,page in enumerate(doc):
  tp=page.get_textpage();text=tp.get_text_range();im=page.render(scale=4/3).to_pil().convert('RGB');markers=[]
  for label in ['ROW1','ROW2','ROW3','MERGED','AFTER']:
   at=text.find(label)
   if at<0:continue
   boxes=[tp.get_charbox(at+j) for j in range(len(label))]
   x=math.floor((min(b[0] for b in boxes)-3)*4/3);y=math.floor((page.get_height()-max(b[3] for b in boxes)-3)*4/3)
   r=math.ceil((max(b[2] for b in boxes)+3)*4/3);b=math.ceil((page.get_height()-min(b[1] for b in boxes)+3)*4/3)
   crop=im.crop((x,y,r,b));mask=crop.point(lambda v:255 if v<160 else 0).convert('L');box=mask.getbbox()
   markers.append({'label':label,'region':[x,y,r,b],'inkBox':None if box is None else [box[0]+x,box[1]+y,box[2]+x,box[3]+y]})
  pages.append({'case':cases[i],'markers':markers})
 result={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(native.read_bytes()).hexdigest(),'pages':pages}
 (ROOT/f'native-{mode}.json').write_text(json.dumps(result,indent=2))
 print(mode,len(pages),'pages',sum(len(p['markers']) for p in pages),'markers')
