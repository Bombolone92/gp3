"""Original OPC/XML probe for DrawingML quadratic and cubic paths."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from canvas_first_section_fixture import parts as base, W, R
from canvas_custom_geometry_fixture import A, WP, S
G = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
ROOT = Path(__file__).resolve().parents[1]
CASES = [
 ('cubic-lens', [('M',0,50),('C',0,-20,100,-20,100,50),('C',100,120,0,120,0,50),('Z',)]),
 ('quadratic-cap', [('M',0,75),('Q',50,-75,100,75),('L',100,100),('L',0,100),('Z',)]),
 ('outside-frame', [('M',0,50),('C',20,-180,80,280,100,50)]),
 ('degenerate-curves', [('M',0,0),('Q',50,50,100,100),('C',100,100,100,100,0,100),('Z',)]),
 ('close-then-curve', [('M',10,10),('L',90,10),('L',50,40),('Z',),('Q',-30,90,90,90),('L',10,90),('Z',)]),
 ('nested-guides', [('M',0,50),('C',0,'upper',100,'upper',100,50),('Q','middle',140,0,50),('Z',)]),
]

def generate(cases=CASES, name="bezier-paths"):
 body='<w:p><w:r><w:t>Bezier geometry</w:t></w:r></w:p>';manifest=[]
 for i,(case_name,commands) in enumerate(cases):
  x,y=85+(i%2)*270,105+(i//2)*220; width,height=120*12700,100*12700
  nested=i==5; sw,sh=(width*2,height//2) if nested else (width,height)
  path=''
  for op,*coords in commands:
   tag={'M':'moveTo','L':'lnTo','C':'cubicBezTo','Q':'quadBezTo','Z':'close'}[op]
   path+=f'<a:{tag}>'+''.join(f'<a:pt x="{coords[j]}" y="{coords[j+1]}"/>' for j in range(0,len(coords),2))+f'</a:{tag}>'
  geom='<a:custGeom><a:avLst/><a:gdLst><a:gd name="upper" fmla="val -20"/><a:gd name="middle" fmla="*/ 100 1 2"/></a:gdLst><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>'+f'<a:path w="100" h="100" fill="{"none" if i==2 else "norm"}">{path}</a:path></a:pathLst></a:custGeom>'
  shape=f'<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{sw}" cy="{sh}"/></a:xfrm>{geom}<a:solidFill><a:srgbClr val="208060"/></a:solidFill><a:ln w="{38100 if i==2 else 6350}"><a:solidFill><a:srgbClr val="208060"/></a:solidFill><a:round/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'
  if nested:
   def group(content,w,h,cw,ch,tag):return f'<wpg:{tag}><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{w}" cy="{h}"/><a:chOff x="0" y="0"/><a:chExt cx="{cw}" cy="{ch}"/></a:xfrm></wpg:grpSpPr>{content}</wpg:{tag}>'
   shape=group(group(shape,sw,sh,sw,sh,'grpSp'),width,height,sw,sh,'wgp')
  body+=f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{i+1}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>{x*12700}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{y*12700}</wp:posOffset></wp:positionV><wp:extent cx="{width}" cy="{height}"/><wp:wrapNone/><wp:docPr id="{i+1}" name="{case_name}"/><a:graphic><a:graphicData uri="{G if nested else S}">{shape}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
  manifest.append(dict(name=case_name,x=x,y=y,width=120,height=100))
 body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
 parts=dict(base);parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{S}" xmlns:wpg="{G}"><w:body>{body}</w:body></w:document>'
 with ZipFile(ROOT/f'public/fixtures/{name}.docx','w',ZIP_DEFLATED) as z:
  for part_name,data in parts.items():z.writestr(part_name,data)
 folder=ROOT/f'tests/fixtures/{name}';folder.mkdir(exist_ok=True)
 (folder/'cases.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')

CLOSED = [('M',10,10),('L',90,10),('L',50,40),('Z',)]
CLOSE_CASES = [
 ('close-line', CLOSED+[('L',90,90),('Z',)]),
 ('close-quadratic', CLOSED+[('Q',-30,90,90,90),('Z',)]),
 ('close-cubic', CLOSED+[('C',-30,90,90,90,90,10),('Z',)]),
 ('close-move-quadratic', CLOSED+[('M',10,50),('Q',50,10,90,50),('Z',)]),
 ('close-unclosed-quadratic', CLOSED+[('Q',-30,90,90,90)]),
 ('close-close', CLOSED+[('Z',)]),
]
if __name__=='__main__':
 generate()
 generate(CLOSE_CASES, 'bezier-close-paths')
