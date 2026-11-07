"""Original inline preset/custom/group controls across compatibility modes."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json
OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/inline-shape-frames'
OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
WPG='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
angles=[0,44,45,90,135,180,225,270,315]
cases=[{'kind':kind,'angle':angle} for kind in ['preset','custom','group','line'] for angle in angles]
for mode in [12,14,15]:
 paras=[]
 for i,case in enumerate(cases):
  kind,angle=case['kind'],case['angle']
  transform=f'<a:xfrm rot="{angle*60000 if kind!="group" else 0}"><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>'
  geometry='<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
  if kind=='custom':geometry='<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>'
  if kind=='line':geometry='<a:prstGeom prst="line"><a:avLst/></a:prstGeom>'
  outline='<a:ln w="12700"><a:solidFill><a:srgbClr val="0080C0"/></a:solidFill></a:ln>' if kind=='line' else '<a:ln><a:noFill/></a:ln>'
  shape=f'<wps:wsp><wps:cNvSpPr/><wps:spPr>{transform}{geometry}<a:solidFill><a:srgbClr val="0080C0"/></a:solidFill>{outline}</wps:spPr><wps:bodyPr/></wps:wsp>'
  if kind=='group':shape=f'<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm rot="{angle*60000}"><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="457200"/></a:xfrm></wpg:grpSpPr>{shape}</wpg:wgp>'
  drawing=f'<w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="{i+1}" name="Original {kind} {angle}"/><a:graphic><a:graphicData uri="{WPG if kind=="group" else WPS}">{shape}</a:graphicData></a:graphic></wp:inline></w:drawing>'
  props='<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>'
  pagebreak='<w:pageBreakBefore/>' if i and i%9==0 else ''
  paras.append(f'<w:p><w:pPr>{pagebreak}<w:spacing w:before="400" w:after="400"/></w:pPr><w:r>{props}<w:t>{kind} {angle}:A</w:t></w:r><w:r>{props}{drawing}</w:r><w:r>{props}<w:t>B</w:t></w:r></w:p>')
 document=f'<w:document xmlns:w="{W}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{WPS}" xmlns:wpg="{WPG}"><w:body>{"".join(paras)}<w:sectPr><w:pgSz w:w="12240" w:h="31680"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
 parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
 'word/document.xml':document,
 'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'}
 with ZipFile(OUT/f'mode-{mode}.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items():z.writestr(name,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
