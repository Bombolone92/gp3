"""Original image mask/downsampling controls; pass --scaled for 8x bitmaps."""
from pathlib import Path
from io import BytesIO
import base64,json,sys
from PIL import Image,ImageDraw,ImageOps
import canvas_svg_fixture as fixture
step='--step' in sys.argv
scaled='--scaled' in sys.argv or step
name='svg-image-masks'+('-step' if step else '-scaled' if scaled else '')
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures'/name;folder.mkdir(exist_ok=True)
fixture.SOURCE=root/'public/fixtures'/f'{name}.docx'
im=Image.new('RGB',(128,480),'black')
if step: ImageDraw.Draw(im).rectangle((64,0,127,479),fill='white')
else: ImageDraw.Draw(im).ellipse((0,0,127,479),fill='white')
if not scaled: im=im.resize((16,60),Image.Resampling.LANCZOS)
def uri(image,fmt):
    data=BytesIO();image.save(data,format=fmt,**({'quality':95,'subsampling':0} if fmt=='JPEG' else {}))
    return 'data:image/'+('jpeg' if fmt=='JPEG' else 'png')+';base64,'+base64.b64encode(data.getvalue()).decode()
defs=['<filter id="invert" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/></filter>'];shapes=[]
cases=['vector-white','vector-nearly-opaque','png','png-inverted','jpeg','jpeg-inverted']
for i,name in enumerate(cases):
    x=2+i*20
    if i<2:content=f'<ellipse cx="{x+8}" cy="40" rx="8" ry="30" fill="white" fill-opacity="{1 if i==0 else .999}"/>'
    else:
        inverted=i%2==1
        content=f'<image x="{x}" y="10" width="16" height="60" href="{uri(ImageOps.invert(im) if inverted else im,"PNG" if i<4 else "JPEG")}"'+(' filter="url(#invert)"' if inverted else '')+'/>'
    defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60">{content}</mask>')
    shapes.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060C0" mask="url(#m{i})"/>')
fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>'+''.join(defs)+'</defs>'+''.join(shapes)+'</svg>').encode()
fixture.generate();(folder/'cases.json').write_text(json.dumps(cases,indent=2))
