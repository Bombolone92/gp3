"""Independent custom geometry fixture. Original OPC/XML; standard library only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
from xml.etree import ElementTree as E
from canvas_first_section_fixture import parts as base, W, R
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
ROOT=Path(__file__).resolve().parents[1]
# Each final guide determines a filled bar's width as a percentage of its frame.
CASES=[('multiply','*/ 70 2 3',None),('add-subtract','+- 60 30 10',None),('add-divide','+/ 60 30 2',None),('conditional','?: -1 30 70',None),('absolute','abs -60',None),('arctangent','at2 1 1','*/ raw 100 21600000'),('cos-arctangent','cat2 100 3 4',None),('cosine','cos 100 3600000',None),('maximum','max 20 70',None),('minimum','min 20 70',None),('modulus','mod 20 30 60',None),('pin','pin 20 90 70',None),('sin-arctangent','sat2 100 3 4',None),('sine','sin 100 1800000',None),('square-root','sqrt 4900',None),('tangent','tan 50 2700000',None),('literal','val 65',None),('atan-quadrant2','at2 -1 1','*/ raw 100 21600000'),('atan-quadrant3','at2 -1 -1','+- raw 21600000 0'),('text-rectangle','val 25',None)]
def generate():
 body='<w:p><w:r><w:t>Custom geometry guide formulas</w:t></w:r></w:p>'
 manifest=[]
 width,height=2286000,254000
 for i,(label,formula,derived) in enumerate(CASES):
  x,y=54+(i//10)*270,95+(i%10)*56
  guides=f'<a:gd name="raw" fmla="{escape(formula, {chr(34): "&quot;"})}"/>'
  if i==18:
   guides+=f'<a:gd name="angle" fmla="{derived}"/><a:gd name="percent" fmla="*/ angle 100 21600000"/>'
  else: guides+=f'<a:gd name="percent" fmla="{derived or "val raw"}"/>'
  guides+='<a:gd name="end" fmla="*/ percent w 100"/><a:gd name="inset" fmla="*/ w adj 100"/><a:gd name="textRight" fmla="+- w 0 inset"/>'
  # Two path coordinate systems: explicit small values and shape coordinates.
  pathw=180 if i%2 else width
  guides+=f'<a:gd name="pathEnd" fmla="*/ percent {pathw} 100"/>'
  geom=f'<a:custGeom><a:avLst><a:gd name="adj" fmla="val 25"/></a:avLst><a:gdLst>{guides}</a:gdLst><a:ahLst/><a:cxnLst><a:cxn ang="cd4"><a:pos x="end" y="vc"/></a:cxn></a:cxnLst><a:rect l="inset" t="0" r="textRight" b="b"/><a:pathLst><a:path w="{pathw}" h="20"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="pathEnd" y="0"/></a:lnTo><a:lnTo><a:pt x="pathEnd" y="20"/></a:lnTo><a:lnTo><a:pt x="0" y="20"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>'
  tx='<wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="000000"/><w:sz w:val="20"/></w:rPr><w:t>Inset text</w:t></w:r></w:p></w:txbxContent></wps:txbx>' if i==19 else ''
  shape=f'<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{width}" cy="{height}"/></a:xfrm>{geom}<a:solidFill><a:srgbClr val="208060"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="208060"/></a:solidFill><a:headEnd/><a:tailEnd/></a:ln></wps:spPr>{tx}<wps:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" anchor="t"><a:noAutofit/></wps:bodyPr></wps:wsp>'
  body+=f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{i+1}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>{x*12700}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{y*12700}</wp:posOffset></wp:positionV><wp:extent cx="{width}" cy="{height}"/><wp:wrapNone/><wp:docPr id="{i+1}" name="{label}"/><a:graphic><a:graphicData uri="{S}">{shape}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
  manifest.append(dict(name=label,x=x,y=y,width=180,height=20,formula=formula))
 body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
 parts=dict(base);parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{S}"><w:body>{body}</w:body></w:document>'
 out=ROOT/'public/fixtures/custom-geometry-guides.docx'
 with ZipFile(out,'w',ZIP_DEFLATED) as z:
  for name,data in parts.items():z.writestr(name,data)
 dest=ROOT/'tests/fixtures/custom-geometry-guides';dest.mkdir(exist_ok=True)
 (dest/'cases.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
 # Fractional negative coordinates test rounding across zero and drawing ink
 # outside the nominal shape frame. All other content is held constant.
 for prefix,uri in [('w',W),('r',R),('a',A),('wp',WP),('wps',S)]: E.register_namespace(prefix,uri)
 root=E.fromstring(parts['word/document.xml']);ns={'a':A}
 for i,geom in enumerate(root.findall('.//a:custGeom',ns)[:4]):
  E.SubElement(geom.find('a:gdLst',ns),'{'+A+'}gd',name='negative',fmla=f'*/ -{2*i+1} 1 2')
  geom.find("a:gdLst/a:gd[@name='pathEnd']",ns).set('fmla','*/ percent 180 100')
  path=geom.find('a:pathLst/a:path',ns);path.set('w','180')
  for point in [path.find('a:moveTo/a:pt',ns),path.findall('a:lnTo/a:pt',ns)[2]]:point.set('x','negative')
 parts['word/document.xml']=E.tostring(root,encoding='utf-8',xml_declaration=True)
 with ZipFile(ROOT/'public/fixtures/custom-geometry-negative.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items():z.writestr(name,data)
 print(out)
if __name__=='__main__':generate()
