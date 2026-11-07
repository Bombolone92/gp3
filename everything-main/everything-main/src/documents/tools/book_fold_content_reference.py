"""Record native text origins and independently colored anchored rectangles."""
from pathlib import Path
import ctypes, hashlib, json
import pypdfium2 as pdf
from PIL import ImageChops
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/book-fold'
records=[]
for name in ['content','numbered','content-gutter','content-even','floating']:
    pages=[]
    with pdf.PdfDocument(folder/(name+'-native.pdf')) as document:
        for page in document:
            text=page.get_textpage();chars=[]
            for i in range(text.count_chars()):
                char=text.get_text_range(i,1)
                if not char.strip():continue
                x,y=ctypes.c_double(),ctypes.c_double()
                assert pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
                chars.append(dict(text=char,x=x.value,y=page.get_height()-y.value))
            im=page.render(scale=2).to_pil().convert('RGB');rectangles={}
            for label,color in [('page',[204,34,51]),('margin',[34,136,68]),('wrapped',[34,68,204])]:
                if name=='floating':break
                masks=[channel.point(lambda x,c=c:255 if abs(x-c)<5 else 0) for channel,c in zip(im.split(),color)]
                box=ImageChops.multiply(ImageChops.multiply(masks[0],masks[1]),masks[2]).getbbox()
                assert box,label
                rectangles[label]=[v/2 for v in box]
            pages.append(dict(chars=chars,rectangles=rectangles));text.close();page.close()
    records.append(dict(name=name,pages=pages,sourceSha256=hashlib.sha256((folder/(name+'.docx')).read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/(name+'-native.pdf')).read_bytes()).hexdigest()))
(folder/'content-reference.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
for c in records:print(c['name'],[(p['chars'][0],p['rectangles']) for p in c['pages']])
