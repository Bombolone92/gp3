"""Author independent screen-phase controls for flat/round/square line caps."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib, json, sys
from canvas_first_section_fixture import parts as base, W

ROOT=Path(__file__).resolve().parents[1]
assert sys.argv[1:] in ([],['--pens'])
pens=sys.argv[1:]==['--pens']
folder=ROOT/'tests/fixtures'/('axis-line-display-pens' if pens else 'axis-line-display')
folder.mkdir(parents=True,exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
parts=dict(base);body='';cases=[]
for row,rowValue in enumerate([.5,.75,1.5,2.25,3,4.5] if pens else [0,.25,.5,.75]):
 for col,colValue in enumerate([0,.25,.5,.75] if pens else ['flat','rnd','sq']):
  phase=colValue if pens else rowValue
  cap='flat' if pens else colValue
  pen=round(rowValue*12700) if pens else 44450
  for orientation in ['horizontal','vertical']:
   x=(48+180*col+phase+(100 if orientation=='vertical' else 0)) if pens else 64+240*col+phase+(120 if orientation=='vertical' else 0)
   y=(32+92*row+phase+(16 if orientation=='vertical' else 0)) if pens else 96+132*row+phase+(28 if orientation=='vertical' else 0)
   length=64 if pens else 96
   width,height=(length,0) if orientation=='horizontal' else (0,length)
   emu=lambda v:round(v*9525)
   case=dict(id=len(cases)+1,cap=cap,orientation=orientation,phase=phase,
    xEmu=emu(x),yEmu=emu(y),widthEmu=emu(width),heightEmu=emu(height),penEmu=pen)
   cases.append(case)
   shape=f'<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{case["widthEmu"]}" cy="{case["heightEmu"]}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="{pen}" cap="{cap}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:round/></a:ln></wps:spPr><wps:bodyPr><a:noAutofit/></wps:bodyPr></wps:wsp>'
   body+=f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{case["id"]}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>{case["xEmu"]}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{case["yEmu"]}</wp:posOffset></wp:positionV><wp:extent cx="{case["widthEmu"]}" cy="{case["heightEmu"]}"/><wp:wrapNone/><wp:docPr id="{case["id"]}" name="{cap} {orientation} phase {phase}"/><a:graphic><a:graphicData uri="{S}">{shape}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{S}"><w:body>{body}</w:body></w:document>'
for name in ['word/fontTable.xml']:
 if name in parts:
  assert 'embedRegular' not in parts[name]
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as archive:
 for name,data in parts.items():
  info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED
  archive.writestr(info,data)
(folder/'cases.json').write_bytes((json.dumps(cases,indent=2)+'\n').encode('utf-8'))
print(json.dumps(dict(cases=len(cases),sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest())))
