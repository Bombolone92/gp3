"""Original WordprocessingShape line preset probes, authored as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from canvas_first_section_fixture import parts as base, W, R
from canvas_custom_geometry_fixture import A, WP, S
G='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
ROOT=Path(__file__).resolve().parents[1]

def generate():
 body='<w:p><w:r><w:t>Line geometry</w:t></w:r></w:p>';manifest=[]
 cases=['diagonal','horizontal','vertical','nested-horizontal','nested-vertical','nested-diagonal','overflow','no-outline']
 for i,name in enumerate(cases):
  x,y=80+(i%2)*280,110+(i//2)*160
  sx,sy=(.5,2) if i in [3,5] else (2,.5) if i==4 else (1,1)
  cw,ch=int(120/sx*12700),int(80/sy*12700)
  lx,ly,lw,lh=0,0,cw,ch
  if i in [1,3]:ly=ch//2;lh=0
  if i in [2,4]:lx=cw//2;lw=0
  if i==6:lx=-20*12700;ly=-10*12700;lw=160*12700;lh=100*12700
  line='<a:noFill/>' if i==7 else '<a:solidFill><a:srgbClr val="208060"/></a:solidFill>'
  shape=f'<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="{lx}" y="{ly}"/><a:ext cx="{lw}" cy="{lh}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="F02020"/></a:solidFill><a:ln w="25400">{line}<a:prstDash val="solid"/><a:headEnd type="none"/><a:tailEnd type="none"/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'
  def group(content,tag,w,h,childw,childh):return f'<wpg:{tag}><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{w}" cy="{h}"/><a:chOff x="0" y="0"/><a:chExt cx="{childw}" cy="{childh}"/></a:xfrm></wpg:grpSpPr>{content}</wpg:{tag}>'
  if i in [3,4,5]:shape=group(shape,'grpSp',cw,ch,cw,ch)
  if i!=0:shape=group(shape,'wgp',120*12700,80*12700,cw,ch)
  body+=f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{i+1}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>{x*12700}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{y*12700}</wp:posOffset></wp:positionV><wp:extent cx="1524000" cy="1016000"/><wp:wrapNone/><wp:docPr id="{i+1}" name="{name}"/><a:graphic><a:graphicData uri="{S if i==0 else G}">{shape}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
  manifest.append(dict(name=name,x=x,y=y,width=120,height=80))
 body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
 parts=dict(base);parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{S}" xmlns:wpg="{G}"><w:body>{body}</w:body></w:document>'
 with ZipFile(ROOT/'public/fixtures/preset-lines.docx','w',ZIP_DEFLATED) as z:
  for part,data in parts.items():z.writestr(part,data)
 folder=ROOT/'tests/fixtures/preset-lines';folder.mkdir(exist_ok=True)
 (folder/'cases.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':generate()
