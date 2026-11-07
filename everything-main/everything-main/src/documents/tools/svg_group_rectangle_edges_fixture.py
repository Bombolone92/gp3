"""Original integer/fractional rectangle coverage in translucent SVG groups."""
from pathlib import Path
import json
import canvas_svg_fixture as fixture
root=Path(__file__).resolve().parents[1]
name='svg-group-rectangle-edges'
fixture.SOURCE=root/'public/fixtures'/(name+'.docx')
folder=root/'tests/fixtures'/name
folder.mkdir(exist_ok=True)
cases=[dict(x=2+i*20+dx,y=10+dy,width=16,height=60,opacity=a) for i,(dx,dy,a) in enumerate([(0,0,.5),(.75,.75,.8),(.25,.5,.5),(.125,.25,.75),(1.5,0,.25),(0,1.5,.5)])]
fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">'+''.join(f'<g opacity="{c["opacity"]}"><rect x="{c["x"]}" y="{c["y"]}" width="{c["width"]}" height="{c["height"]}" fill="#2060C0"/></g>' for c in cases)+'</svg>').encode()
fixture.generate()
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
