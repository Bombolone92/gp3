"""Original neutral gray texture markers; derive only from our authored OPC."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from PIL import Image,ImageDraw
from io import BytesIO
import shutil
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/picture-3d-texture-markers';folder.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/picture-3d-circle-outlines/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
image=Image.new('RGB',(256,256),(128,128,128));draw=ImageDraw.Draw(image)
for start,color in [(64,80),(192,180)]:
 draw.rectangle((start,0,start+7,255),fill=(color,)*3)
 draw.rectangle((0,start,255,start+7),fill=(color,)*3)
stream=BytesIO();image.save(stream,format='PNG');parts['word/media/gray.png']=stream.getvalue()
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
shutil.copyfile(root/'tests/fixtures/picture-3d-circle-outlines/cases.json',folder/'cases.json')
