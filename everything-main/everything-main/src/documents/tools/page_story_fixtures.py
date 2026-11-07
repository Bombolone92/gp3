from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';REL='http://schemas.openxmlformats.org/package/2006/relationships';CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
OUT=Path(__file__).resolve().parents[1] / 'tests/fixtures/page-stories';OUT.mkdir(exist_ok=True)
for mode in ['default','first-hidden','variants']:
 variants=['default','first','even'] if mode=='variants' else ['default']
 parts={};overrides=[];relations=[]
 for kind in variants:
  path=f'word/footer-{kind}.xml';overrides.append(f'<Override PartName="/{path}" ContentType="{CT}footer+xml"/>');relations.append(f'<Relationship Id="{kind}" Type="{R}/footer" Target="footer-{kind}.xml"/>')
  label=kind.title()+' ';props='<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/>'
  parts[path]=f'<w:ftr xmlns:w="{W}"><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="right"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{label}</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE \\* MERGEFORMAT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr>{props}</w:rPr><w:t>99</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>'
 body=''.join(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i>1 else ""}</w:pPr><w:r><w:t>Body page {i}</w:t></w:r></w:p>' for i in range(1,4))
 refs=''.join(f'<w:footerReference w:type="{kind}" r:id="{kind}"/>' for kind in variants)
 parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}<w:sectPr>{refs}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>{"<w:titlePg/>" if mode!="default" else ""}</w:sectPr></w:body></w:document>'
 parts['word/settings.xml']=f'<w:settings xmlns:w="{W}">{"<w:evenAndOddHeaders/>" if mode=="variants" else ""}</w:settings>'
 parts['word/_rels/document.xml.rels']=f'<Relationships xmlns="{REL}">{"".join(relations)}<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>'
 parts['_rels/.rels']=f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>'
 parts['[Content_Types].xml']=f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/>{"".join(overrides)}</Types>'
 with ZipFile(OUT/f'footer-{mode}.docx','w',ZIP_DEFLATED)as z:
  for name,data in parts.items():z.writestr(name,data)
