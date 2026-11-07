"""Record native reference glyph origins and independently rendered picture bounds."""
from pathlib import Path
import ctypes,hashlib,json
import pypdfium2 as pdfium
from PIL import ImageChops
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/square-wrap-flow'
result={}
for source,pdf_name in [('square-wrap-flow','native'),('square-wrap-footer-heights','footer-heights-native'),('square-wrap-footer-modern','footer-modern-native')]:
 pdf=folder/(pdf_name+'.pdf');doc=pdfium.PdfDocument(pdf);pages=[]
 for page in doc:
  text=page.get_textpage();lines=[];last_y=None
  for i in range(text.count_chars()):
   char=text.get_text_range(i,1)
   if char in '\r\n':continue
   x=ctypes.c_double();y=ctypes.c_double();pdfium.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
   if last_y is None or abs(last_y-y.value)>.5:lines.append(dict(baseline=round(page.get_height()-y.value,4),text='',glyphs=[]));last_y=y.value
   lines[-1]['text']+=char;lines[-1]['glyphs'].append([char,round(x.value,4)])
  im=page.render(scale=4).to_pil().convert('RGB');r,g,b=im.split()
  mask=ImageChops.multiply(ImageChops.multiply(r.point(lambda v:255 if v<20 else 0),g.point(lambda v:255 if v>150 else 0)),b.point(lambda v:255 if v<20 else 0))
  bounds=[]
  for top,bottom in [(0,round((page.get_height()-90)*4)),(round((page.get_height()-90)*4),im.height)]:
   box=mask.crop((0,top,im.width,bottom)).getbbox()
   if box:bounds.append([box[0]/4,(box[1]+top)/4,box[2]/4,(box[3]+top)/4])
  lines.sort(key=lambda line:line['baseline'])
  pages.append(dict(lines=lines,pictures=bounds))
 result[source]=dict(sourceSha256=hashlib.sha256((root/'public/fixtures'/f'{source}.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),pages=pages)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
for name,doc in result.items():
 print(name,[(next(l for l in p['lines'] if l['text'].startswith('Footer text'))['glyphs'][0],p['pictures'][-1]) for p in doc['pages']])
