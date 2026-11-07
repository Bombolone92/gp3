"""Original mask luminance, opacity and alpha-mode compatibility controls."""
from pathlib import Path
import sys,json
import canvas_svg_fixture as fixture
out=Path(__file__).resolve().parents[1]/'tests/fixtures/svg-mask-opacity-expanded';out.mkdir(exist_ok=True)
fixture.SOURCE=Path(__file__).resolve().parents[1]/'public/fixtures/svg-mask-opacity-expanded.docx'
cases=[('gray-opaque','#808080',1,'luminance'),('blue-opaque','#2060C0',1,'luminance'),('white-object-half','white',1,'luminance'),('white-group-half','white',1,'luminance'),('black-style-alpha','black',1,'alpha'),('gray-style-alpha','#808080',1,'alpha')]
defs=[];shapes=[]
for i,(name,color,opacity,kind) in enumerate(cases):
 x=2+i*20
 mask=f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60" mask-type="{kind}"><ellipse cx="{x+8}" cy="40" rx="8" ry="30" fill="{color}" fill-opacity="{opacity}"/></mask>'
 if i==2:mask=mask.replace('<ellipse','<ellipse opacity="0.5"')
 if i==3:mask=mask.replace('<ellipse','<g opacity="0.5"><ellipse').replace('/></mask>','/></g></mask>')
 if i in [4,5]:mask=mask.replace('mask-type="alpha"','style="mask-type:alpha"')
 defs.append(mask)
 shapes.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060C0" mask="url(#m{i})"/>')
fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>'+''.join(defs)+'</defs>'+''.join(shapes)+'</svg>').encode()
fixture.generate();(out/'cases.json').write_text(json.dumps(cases,indent=2))
