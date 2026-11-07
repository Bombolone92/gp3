"""Original controls for retained, disabled first/even page stories."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
out=Path(__file__).resolve().parents[1]/'tests/fixtures/inactive-stories'
out.mkdir(exist_ok=True)
for mode in ['disabled','first','even']:
 parts={}; refs=[]; rels=[]; types=[]
 for variant in ['default','first','even']:
  name=f'word/header-{variant}.xml'
  content='<w:r><w:t>Visible default header</w:t></w:r>' if variant=='default' else f'<w:fldSimple w:instr=" COMPARE 1 = 1 " w:fldLock="true"><w:r><w:t>Retained {variant} author</w:t></w:r></w:fldSimple>'
  parts[name]=f'<w:hdr xmlns:w="{W}"><w:p>{content}</w:p></w:hdr>'
  refs.append(f'<w:headerReference w:type="{variant}" r:id="{variant}"/>')
  rels.append(f'<Relationship Id="{variant}" Type="{R}/header" Target="header-{variant}.xml"/>')
  types.append(f'<Override PartName="/{name}" ContentType="{CT}header+xml"/>')
 body=''.join(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i>1 else ""}</w:pPr><w:r><w:t>Body page {i}</w:t></w:r></w:p>' for i in range(1,4))
 parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}<w:sectPr>{"".join(refs)}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:titlePg w:val="{1 if mode=="first" else 0}"/></w:sectPr></w:body></w:document>'
 parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:evenAndOddHeaders w:val="{1 if mode=="even" else 0}"/></w:settings>'
 parts['word/_rels/document.xml.rels']=f'<Relationships xmlns="{REL}">{"".join(rels)}<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>'
 parts['_rels/.rels']=f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>'
 parts['[Content_Types].xml']=f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/>{"".join(types)}</Types>'
 with ZipFile(out/f'{mode}.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items(): z.writestr(name,data)
