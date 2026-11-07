"""Original solid SVG compositing controls, without corpus artwork."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import canvas_svg_fixture as fixture

OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/svg-backdrop-compositing'
OUT.mkdir(parents=True,exist_ok=True)
backgrounds=['FFFFFF','F2F2F2','808080','202020']
colors=['4080C0','5A9493','FED19F','A77E53']
cases=[];shapes=[]
for row,(color,opacity) in enumerate((color,opacity) for color in colors for opacity in [.1,.3]):
 for col,background in enumerate(backgrounds):
  x,y=col*30,row*10
  shapes.append(f'<rect x="{x}" y="{y}" width="30" height="10" fill="#{background}"/><rect x="{x}" y="{y}" width="30" height="10" fill="#{color}" opacity="{opacity}"/>')
  cases.append(dict(row=row,column=col,background=background,color=color,opacity=opacity))
for col,background in enumerate(backgrounds):
 x,y=col*30,80
 shapes.append(f'<rect x="{x}" y="{y}" width="30" height="10" fill="#{background}"/><rect x="{x}" y="{y}" width="30" height="10" fill="#FED19F" opacity="0.3"/><rect x="{x}" y="{y}" width="30" height="10" fill="#A77E53" opacity="0.1"/>')
 cases.append(dict(row=8,column=col,background=background,color='FED19F',opacity=.3,overlay=dict(color='A77E53',opacity=.1)))
fixture.SOURCE=OUT/'control.docx'
fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90">'+''.join(shapes)+'</svg>').encode()
fixture.generate()
with ZipFile(fixture.SOURCE) as z:parts={n:z.read(n) for n in z.namelist()}
with ZipFile(fixture.SOURCE,'w') as z:
 for name,data in parts.items():
  info=ZipInfo(name,(2026,9,25,12,0,0));info.create_system=0;info.external_attr=0o600<<16
  z.writestr(info,data,compress_type=ZIP_DEFLATED)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
