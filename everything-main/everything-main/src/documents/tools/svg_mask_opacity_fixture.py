"""Original mask luminance, opacity and alpha-mode compatibility controls."""
from pathlib import Path
import sys,json
import canvas_svg_fixture as fixture
out=Path(__file__).resolve().parents[1]/'tests/fixtures/svg-mask-opacity';out.mkdir(exist_ok=True)
fixture.SOURCE=Path(__file__).resolve().parents[1]/'public/fixtures/svg-mask-opacity.docx'
cases=[('white-opaque','white',1,'luminance'),('white-half','white',.5,'luminance'),('white-eighth','white',.125,'luminance'),('gray-half','#808080',.5,'luminance'),('black-half-alpha','black',.5,'alpha'),('blue-half','#2060C0',.5,'luminance')]
defs=[];shapes=[]
for i,(name,color,opacity,kind) in enumerate(cases):
 x=2+i*20
 defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60" mask-type="{kind}"><ellipse cx="{x+8}" cy="40" rx="8" ry="30" fill="{color}" fill-opacity="{opacity}"/></mask>')
 shapes.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060C0" mask="url(#m{i})"/>')
fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>'+''.join(defs)+'</defs>'+''.join(shapes)+'</svg>').encode()
fixture.generate();(out/'cases.json').write_text(json.dumps(cases,indent=2))
