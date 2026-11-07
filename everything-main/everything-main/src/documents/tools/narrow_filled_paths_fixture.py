"""Original narrow filled geometry; no corpus artwork or renderer export."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
from canvas_first_section_fixture import parts as envelope, W, R

root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/narrow-filled-paths';folder.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
G='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
emu=lambda p:round(p*12700)
cases=[]
def shape(paths, color, width=120, height=240):
 return f'<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu(width)}" cy="{emu(height)}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>{paths}</a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'
def polygon(points):
 cmds=''.join(f'<a:{"moveTo" if i==0 else "lnTo"}><a:pt x="{round(x*10000)}" y="{round(y*10000)}"/></a:{"moveTo" if i==0 else "lnTo"}>' for i,(x,y) in enumerate(points))
 return '<a:path w="1200000" h="2400000" stroke="0">'+cmds+'<a:close/></a:path>'
body='<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr><w:t>Narrow filled paths without outlines</w:t></w:r></w:p>'
for index,(name,x,y,color,bg,scale) in enumerate([
 ('black-direct',45,90,'000000','FFFFFF',1),('white-direct',190,90,'FFFFFF','202060',1),
 ('white-group-half',335,90,'FFFFFF','202060',.5),('black-group-double',45,390,'000000','FFFFFF',2)]):
 paths=[]
 for row,thickness in enumerate([.03,.06,.12,.25,.5,1,2,4]):
  top=12+row*27
  paths.append(polygon([(10,top),(55,top),(55,top+thickness),(10,top+thickness)]))
  paths.append(polygon([(65,top),(87,top+22),(87,top+22+thickness),(65,top+thickness)]))
  cases.append({'name':name+'-'+str(thickness),'panel':index,'xPt':x,'yPt':y+top,'thicknessPt':thickness,'color':color,'background':bg})
 background=shape(polygon([(0,0),(120,0),(120,240),(0,240)]),bg)
 foreground=shape(''.join(paths),color,120/scale,240/scale)
 group=f'<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu(120)}" cy="{emu(240)}"/><a:chOff x="0" y="0"/><a:chExt cx="{emu(120/scale)}" cy="{emu(240/scale)}"/></a:xfrm></wpg:grpSpPr>{foreground}</wpg:wgp>' if scale!=1 else foreground
 for layer,node,uri in [(0,background,S),(1,group,G if scale!=1 else S)]:
  id_=index*2+layer+1
  body+=f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{251659264+id_}" behindDoc="{1-layer}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>{emu(x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{emu(y)}</wp:posOffset></wp:positionV><wp:extent cx="{emu(120)}" cy="{emu(240)}"/><wp:wrapNone/><wp:docPr id="{id_}" name="{escape(name)}-{layer}"/><a:graphic><a:graphicData uri="{uri}">{node}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts=dict(envelope);parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{S}" xmlns:wpg="{G}"><w:body>{body}</w:body></w:document>'
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
