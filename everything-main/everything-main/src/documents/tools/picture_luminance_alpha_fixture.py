"""Original full-alpha sweep paired with the neutral luminance controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from PIL import Image
from io import BytesIO
import json

root=Path(__file__).resolve().parents[1]
source=root/'tests/fixtures/picture-luminance-neutral'
output=root/'tests/fixtures/picture-luminance-alpha';output.mkdir(exist_ok=True)
with ZipFile(source/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
colors=[(200,40,80,alpha) for alpha in range(256)]
image=Image.new('RGBA',(256,16));image.putdata(colors*16)
buffer=BytesIO();image.save(buffer,format='PNG')
parts['word/media/duotone.png']=buffer.getvalue()
with ZipFile(output/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
cases=json.loads((source/'cases.json').read_text());cases['colors']=colors
(output/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
