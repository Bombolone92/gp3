"""Extract native reference glyph crops for invisible-outline text-frame controls."""
from pathlib import Path
import ctypes,json,hashlib
import pypdfium2 as P
out=Path(__file__).resolve().parents[1]/'tests/fixtures/hidden-outline-text'
cases=json.loads((out/'cases.json').read_text());doc=P.PdfDocument(out/'native.pdf')
for case,page in zip(cases,doc):
 t=page.get_textpage();text=t.get_text_range();start=text.index('&');rgba=[ctypes.c_uint() for _ in range(4)];assert P.raw.FPDFText_GetFillColor(t,start,*[ctypes.byref(x) for x in rgba]);case['nativeColor']=''.join(f'{x.value:02X}' for x in rgba[:3])
 boxes=[t.get_charbox(i) for i in range(start,start+1)];h=page.get_height();box=[min(b[0] for b in boxes)-4,h-max(b[3] for b in boxes)-4,max(b[2] for b in boxes)+4,h-min(b[1] for b in boxes)+4]
 import math
 crop=[math.floor(box[0]*4/3),math.floor(box[1]*4/3),math.ceil(box[2]*4/3),math.ceil(box[3]*4/3)];case['crop']=crop;case['fill']='DDEEFF'
 page.render(scale=4/3).to_pil().convert('RGB').crop(crop).save(out/f"native-crop{case['case']}.png")
 print(case['case'],case['mode'],case['width'],case['nativeColor'])
result={'referenceVersion':'16.0.20326','sha256':{name:hashlib.sha256((out/name).read_bytes()).hexdigest() for name in ['control.docx','native.pdf']},'cases':cases}
(out/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
