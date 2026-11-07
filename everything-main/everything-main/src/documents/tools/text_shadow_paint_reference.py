"""Record native shadow interiors two display pixels from any hard edge."""
from pathlib import Path
from PIL import Image,ImageFilter
import pypdfium2 as pdf,json
p=Path(__file__).resolve().parents[1]/'tests/fixtures/text-shadow-line-metrics';doc=pdf.PdfDocument(p/'matrix-native.pdf');out=[]
for i in range(len(doc)):
 page=doc[i];bitmap=page.render(scale=4);im=bitmap.to_pil().convert('RGB').resize((816,1056),Image.Resampling.BOX)
 crop=im.crop((85,90,750,350));mask=Image.new('L',crop.size);mask.putdata([255 if max(abs(v-136) for v in c)<=1 else 0 for c in crop.get_flattened_data()]);mask=mask.filter(ImageFilter.MinFilter(5));pts=[]
 for y in range(mask.height):
  for x in range(mask.width):
   if (x+y)%7==0 and mask.getpixel((x,y)):pts.append([x+85,y+90])
 print(i+1,len(pts));out.append(pts)
(p/'matrix-paint-reference.json').write_text(json.dumps({'color':[136,136,136],'tolerance':24,'pages':out},separators=(',',':'))+'\n')
