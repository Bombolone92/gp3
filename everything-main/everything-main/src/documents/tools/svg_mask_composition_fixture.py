"""Original paired overlap/edge controls for native luminance masking."""
from pathlib import Path
import json, sys
import canvas_svg_fixture as fixture

root = Path(__file__).resolve().parents[1]
intermediate = '--intermediate' in sys.argv
name = 'svg-mask-composition' + ('-intermediate' if intermediate else '')
folder = root/'tests/fixtures'/name
folder.mkdir(exist_ok=True)
fixture.SOURCE = root/'public/fixtures'/(name+'.docx')
pairs = [('#2060C0',.5,'#FF0000',.5,1),('#FF0000',.5,'#2060C0',.5,1),
         ('#FFFFFF',.75,'#808080',.5,1),('#00FF00',.125,'#2060C0',.75,1),
         ('#123456',1,'#FFFFFF',.5,1),('#FFFFFF',1,'#2060C0',1,.5)]
defs = ['<filter id="identity" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>'] if intermediate else []
shapes, cases = [], []
for i,(first, a, second, b, group) in enumerate(pairs):
    x = 2+i*20
    content = f'<g opacity="{group}"><rect x="{x+1.35}" y="11.4" width="13" height="36" fill="{first}" fill-opacity="{a}"/><rect x="{x+1.35}" y="31.4" width="13" height="36" fill="{second}" fill-opacity="{b}"/></g>'
    cases.append(dict(first=first,firstOpacity=a,second=second,secondOpacity=b,groupOpacity=group))
    if intermediate:
        shapes.append('<g filter="url(#identity)">'+content+'</g>')
    else:
        defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60">{content}</mask>')
        shapes.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060C0" mask="url(#m{i})"/>')
fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>'+''.join(defs)+'</defs>'+''.join(shapes)+'</svg>').encode()
fixture.generate()
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
