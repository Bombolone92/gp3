"""Original controls distinguishing opaque-mask RGB from alpha-weighted luminance."""
from pathlib import Path
import json,sys
import canvas_svg_fixture as fixture
root=Path(__file__).resolve().parents[1]
intermediate='--intermediate' in sys.argv
name='svg-mask-opaque'+('-intermediate' if intermediate else '')
folder=root/'tests/fixtures'/name
folder.mkdir(exist_ok=True)
fixture.SOURCE=root/'public/fixtures'/(name+'.docx')
defs=['<filter id="identity" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>'] if intermediate else []
shapes=[]
cases=['opaque-fractional-rectangle','almost-opaque-ellipse','opaque-with-transparent-paint','opaque-with-translucent-paint','opaque-group','opaque-rgba']
for i,label in enumerate(cases):
 x=2+i*20
 ellipse=f'<ellipse cx="{x+8}" cy="40" rx="8" ry="30" fill="white"'
 if i==0:content=f'<rect x="{x+.35}" y="10.4" width="15" height="59" fill="white"/>'
 elif i==1:content=ellipse+' fill-opacity="0.9999"/>'
 elif i in [2,3]:content=ellipse+f'/><rect x="{x+3}" y="25" width="10" height="20" fill="blue" fill-opacity="{0 if i==2 else .5}"/>'
 elif i==4:content='<g opacity="1">'+ellipse+'/></g>'
 else:content=f'<ellipse cx="{x+8}" cy="40" rx="8" ry="30" fill="rgba(255,255,255,1)"/>'
 if intermediate:shapes.append('<g filter="url(#identity)">'+content+'</g>')
 else:
  defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60">{content}</mask>')
  shapes.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060C0" mask="url(#m{i})"/>')
fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>'+''.join(defs)+'</defs>'+''.join(shapes)+'</svg>').encode()
fixture.generate()
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
