"""Original nested-group and transparent-paint mask controls."""
from pathlib import Path
import json, sys
import canvas_svg_fixture as fixture

root=Path(__file__).resolve().parents[1]
intermediate='--intermediate' in sys.argv
name='svg-mask-nested'+('-intermediate' if intermediate else '')
folder=root/'tests/fixtures'/name
folder.mkdir(exist_ok=True)
fixture.SOURCE=root/'public/fixtures'/(name+'.docx')
def rect(color,alpha,y=11.4,opacity=1):return dict(kind='rect',color=color,alpha=alpha,y=y,opacity=opacity)
def group(alpha,*children):return dict(kind='g',opacity=alpha,children=children)
cases=[
 group(1,rect('#2060C0',.5),group(.5,rect('#FF0000',.5,31.4))),
 group(1,group(.5,rect('#2060C0',.5),rect('#FF0000',.5,31.4)),rect('#00FF00',.125,31.4)),
 group(.5,group(.75,rect('#2060C0',1),rect('#FF0000',.5,31.4))),
 group(.5,rect('#2060C0',.5),rect('#FF0000',.5,31.4)),
 group(1,rect('#3952ED',.999),rect('#FFFFFF',0,31.4)),
 group(1,rect('#3952ED',.999),rect('#FFFFFF',1,31.4,0)),
]
def markup(node,x):
 if node['kind']=='g':return f'<g opacity="{node["opacity"]}">'+''.join(markup(c,x) for c in node['children'])+'</g>'
 return f'<rect x="{x+1.35}" y="{node["y"]}" width="13" height="36" fill="{node["color"]}" fill-opacity="{node["alpha"]}" opacity="{node["opacity"]}"/>'
defs=['<filter id="identity" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>'] if intermediate else []
shapes=[]
for i,case in enumerate(cases):
 x=2+i*20
 content=markup(case,x)
 if intermediate:shapes.append('<g filter="url(#identity)">'+content+'</g>')
 else:
  defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60">{content}</mask>')
  shapes.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060C0" mask="url(#m{i})"/>')
fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>'+''.join(defs)+'</defs>'+''.join(shapes)+'</svg>').encode()
fixture.generate()
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
