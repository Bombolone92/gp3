"""Read native PDF text colors and independently calculate HSL expectations."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
import pypdfium2 as pdf
import ctypes, colorsys, hashlib, json, math

root=Path(__file__).resolve().parents[1]/'tests/fixtures/text-fill-luminance'
doc=pdf.PdfDocument(root/'native.pdf');assert len(doc)==1
page=doc[0];text=page.get_textpage();native=[]
for i in range(text.count_chars()):
 if text.get_text_range(i,1)!='M':continue
 rgba=[ctypes.c_uint() for _ in range(4)]
 assert pdf.raw.FPDFText_GetFillColor(text,i,*[ctypes.byref(v) for v in rgba])
 x,y=ctypes.c_double(),ctypes.c_double()
 pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
 native.append(dict(color=[v.value for v in rgba[:3]],alpha=rgba[3].value,x=x.value,y=page.get_height()-y.value))
cases=json.loads((root/'cases.json').read_text())
assert len(native)==len(cases),(len(native),text.get_text_range())
with ZipFile(root/'control.docx') as z:
 theme=E.fromstring(z.read('word/theme/theme1.xml'))
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
scheme={E.QName(n).localname:n[0].get('val') for n in theme.find('.//a:clrScheme',ns)}
expected=[]
for case in cases:
 rgb=case['color'] if case['kind']=='srgbClr' else scheme[case['color']]
 channels=[int(rgb[i:i+2],16)/255 for i in [0,2,4]]
 for name,value in case['transforms']:
  h,l,s=colorsys.rgb_to_hls(*channels)
  l=max(0,min(1,l+value/100000 if name=='lumOff' else l*value/100000))
  channels=colorsys.hls_to_rgb(h,l,s)
 expected.append([math.floor(c*255+.5) for c in channels])
page.render(scale=4/3).to_pil().save(root/'native.png')
result=dict(referenceBuild='16.0.20326',cases=[dict(**c,native=n,expected=e) for c,n,e in zip(cases,native,expected)],hashes={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['control.docx','cases.json','native.pdf','native.png']})
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
for i,(n,e) in enumerate(zip(native,expected)):print(i+1,n['color'],e)
