"""Independent next-page section spacing probes, authored as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
cases=[dict(id='S00',before=240,previousAfter=None)]
for after in [0,60,160,240,400]: cases.append(dict(id=f'S{len(cases):02}',before=240,previousAfter=after))
for before in [0,60,160,400]: cases.append(dict(id=f'S{len(cases):02}',before=before,previousAfter=160))
cases.extend([dict(id='S10',before=240,previousAfter=60,empty=True),dict(id='S11',before=240,previousAfter=60,breakType='page'),dict(id='S12',before=240,previousAfter=60,breakType='before')])
cases.extend([dict(id='S13',before=240,previousAfter=0,breakType='before'),dict(id='S14',before=240,previousAfter=400,breakType='before'),dict(id='S15',before=60,previousAfter=160,breakType='before'),dict(id='S16',before=240,previousAfter=0,breakType='page'),dict(id='S17',before=240,previousAfter=400,breakType='page')])
sect='<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
body=''
for i,c in enumerate(cases):
 if i:
  mode=c.get('breakType','section')
  body+='<w:p><w:pPr><w:spacing w:before="0" w:after="'+str(c['previousAfter'])+'"/>'+('<w:sectPr>'+sect+'</w:sectPr>' if mode=='section' else '')+'</w:pPr><w:r>'+('' if c.get('empty') else '<w:t>Previous '+c['id']+'</w:t>')+('<w:br w:type="page"/>' if mode=='page' else '')+'</w:r></w:p>'
 body+='<w:p><w:pPr>'+('<w:pageBreakBefore/>' if c.get('breakType')=='before' else '')+'<w:spacing w:before="'+str(c['before'])+'" w:after="0"/></w:pPr><w:r><w:t>Start'+c['id']+'</w:t></w:r></w:p>'
 body+='<w:p><w:r><w:t>Body'+c['id']+'</w:t></w:r></w:p>'
parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/></Relationships>',
 'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>',
 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr>{sect}</w:sectPr></w:body></w:document>',
}
out=ROOT/'public/fixtures/section-before-spacing.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(ZipInfo(name,(2026,9,18,0,0,0)),data,compress_type=ZIP_DEFLATED)
refs=ROOT/'tests/fixtures/section-before-spacing';refs.mkdir(exist_ok=True)
(refs/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print(out)
for name,mode,flag in [('modern',15,False),('suppress',15,True),('legacy',14,False)]:
 variant=dict(parts)
 variant['[Content_Types].xml']=variant['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
 variant['word/_rels/document.xml.rels']=variant['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
 variant['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat>'+('<w:suppressSpBfAfterPgBrk/>' if flag else '')+f'<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'
 target=out.with_stem(out.stem+'-'+name)
 with ZipFile(target,'w',ZIP_DEFLATED) as z:
  for path,data in variant.items():z.writestr(ZipInfo(path,(2026,9,18,0,0,0)),data,compress_type=ZIP_DEFLATED)
 print(target)
