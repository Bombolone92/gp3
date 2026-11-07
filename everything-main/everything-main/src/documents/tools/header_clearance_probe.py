"""Original controls for paragraph spacers, page breaks and signed header clearance."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/header-clearance'
folder.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
for br in [False,True]:
 for size in [4,16]:
  with ZipFile(root/'public/fixtures/chart-metadata-basic.docx') as z:parts={n:z.read(n) for n in z.namelist()}
  def font(s,f='Calibri'):return f'<w:rFonts w:ascii="{f}" w:hAnsi="{f}"/><w:sz w:val="{s*2}"/>'
  parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr>{font(16)}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'.encode()
  parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
  body='<w:p><w:r><w:t>Before</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p>' if br else ''
  body+=f'<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:rPr>{font(size)}</w:rPr></w:pPr></w:p>'
  borders=''.join(f'<w:{s} w:val="single" w:sz="8" w:color="00AA00"/>' for s in ['top','left','bottom','right'])
  body+=f'<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="2318"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:after="80"/><w:rPr>{font(22,"Arial Nova")}</w:rPr></w:pPr><w:r><w:rPr>{font(22,"Arial Nova")}</w:rPr><w:t>VISUAL</w:t></w:r></w:p><w:p><w:pPr><w:rPr>{font(22,"Arial Nova")}<w:b/></w:rPr></w:pPr><w:r><w:rPr>{font(22,"Arial Nova")}<w:b/></w:rPr><w:t>DATA</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p>'
  body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="1440" w:bottom="720" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
  parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
  with ZipFile(folder/f'spacer-{size}-{"break" if br else "start"}.docx','w',ZIP_DEFLATED) as z:
   for n,b in parts.items():z.writestr(n,b)

from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';P='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types'
for size in [4,16]:
 for negative in [False,True]:
  with ZipFile(folder/'spacer-4-start.docx') as z:parts={n:z.read(n) for n in z.namelist()}
  doc=E.fromstring(parts['word/document.xml']);section=doc.find('.//{'+W+'}sectPr');ref=E.Element('{'+W+'}headerReference');ref.set('{'+W+'}type','default');ref.set('{'+R+'}id','probeHeader');section.insert(0,ref)
  margins=section.find('{'+W+'}pgMar');margins.set('{'+W+'}header','720');margins.set('{'+W+'}top','-720' if negative else '720')
  parts['word/document.xml']=E.tostring(doc)
  parts['word/header-probe.xml']=f'<w:hdr xmlns:w="{W}"><w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto" w:after="0"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="{size*2}"/></w:rPr></w:pPr></w:p></w:hdr>'.encode()
  rel=E.fromstring(parts['word/_rels/document.xml.rels']);E.SubElement(rel,'{'+P+'}Relationship',Id='probeHeader',Type=R+'/header',Target='header-probe.xml');parts['word/_rels/document.xml.rels']=E.tostring(rel)
  types=E.fromstring(parts['[Content_Types].xml']);E.SubElement(types,'{'+CT+'}Override',PartName='/word/header-probe.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml');parts['[Content_Types].xml']=E.tostring(types)
  with ZipFile(folder/f'header-spacer-{size}-{"negative" if negative else "positive"}.docx','w',ZIP_DEFLATED) as z:
   for n,b in parts.items():z.writestr(n,b)
