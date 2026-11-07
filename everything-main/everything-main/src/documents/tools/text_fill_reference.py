"""Record native reference text origins and colored ink for original fill controls."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdf

ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/text-fill'
def classify(r,g,b):
    if max(r,g,b)-min(r,g,b)<40:return 'black' if max(r,g,b)<140 else None
    if r>g*1.5 and r>b*1.5:return 'red'
    if g>r*1.5 and g>b*1.5:return 'green'
    if b>r*1.5 and b>g*1.5:return 'blue'
    if g>r*1.5 and b>r*1.5:return 'teal'

refs={}
for name in ['controls','empty-order','shapes','decorations']:
    source,native=ROOT/(name+'.docx'),ROOT/(name+'-native.pdf')
    document=pdf.PdfDocument(native);assert len(document)==1
    page=document[0];text=page.get_textpage();lines=[]
    for i in range(text.count_chars()):
        char=text.get_text_range(i,1)
        if char in '\r\n':continue
        x,y=ctypes.c_double(),ctypes.c_double();pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
        baseline=round(page.get_height()-y.value,4)
        if not lines or abs(lines[-1]['baseline']-baseline)>.4:lines.append(dict(text='',baseline=baseline,chars=[]))
        lines[-1]['text']+=char;lines[-1]['chars'].append(dict(text=char,x=round(x.value,4)))
    raster=page.render(scale=4/3).to_pil().convert('RGB');pixels=raster.load()
    for line in lines:
        # Physical strip around each line covers glyphs, hollow outlines and
        # decorations. Color-specific masks exclude gray editor guides.
        top,bottom=round(line['baseline']*4/3)-25,round(line['baseline']*4/3)+5
        colors={}
        for y in range(top,bottom):
            for x in range(raster.width):
                color=classify(*pixels[x,y])
                if color:
                    c=colors.setdefault(color,dict(count=0,left=x,right=x,top=y,bottom=y));c['count']+=1
                    c['left']=min(c['left'],x);c['right']=max(c['right'],x);c['top']=min(c['top'],y);c['bottom']=max(c['bottom'],y)
        line.update(strip=[top,bottom],colors=colors)
    refs[name]=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(native.read_bytes()).hexdigest(),lines=lines)
(ROOT/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',variants=refs),indent=2)+'\n')
print('Recorded four native text-fill pages')
