"""Original run-level break probes; reuse only our own minimal OPC scaffolding."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import json
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
cases=[dict(id='L01',prefix='page',setup=False),dict(id='L02',prefix='page',after=60),dict(id='L03',prefix='page',after=400),dict(id='L04',prefix='double',after=60),dict(id='L05',prefix='text',after=60),dict(id='L06',prefix='space',after=60)]
sect='<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
body=''
for i,c in enumerate(cases):
 if i:body+='<w:p><w:pPr><w:sectPr>'+sect+'</w:sectPr></w:pPr></w:p>'
 if c.get('setup',True):body+='<w:p><w:pPr><w:spacing w:after="'+str(c['after'])+'"/></w:pPr><w:r><w:t>Setup'+c['id']+'</w:t></w:r></w:p>'
 prefix={'page':'<w:br w:type="page"/>','double':'<w:br w:type="page"/><w:br w:type="page"/>','text':'<w:t>Before'+c['id']+'</w:t><w:br w:type="page"/>','space':'<w:t xml:space="preserve"> </w:t><w:br w:type="page"/>'}[c['prefix']]
 body+='<w:p><w:pPr><w:spacing w:before="240" w:after="0"/></w:pPr><w:r>'+prefix+'<w:t>Start'+c['id']+'</w:t></w:r></w:p><w:p><w:r><w:t>Body'+c['id']+'</w:t></w:r></w:p>'
with ZipFile(ROOT/'public/fixtures/section-before-spacing.docx') as z:parts={n:z.read(n).decode() for n in z.namelist()}
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr>{sect}</w:sectPr></w:body></w:document>'
variants=[('legacy11',11,None),('legacy12',12,None),('legacy14',14,None),('modern',15,None),('modern-off',15,False),('legacy-on',14,True)]
for name,mode,flag in variants:
 out=dict(parts)
 out['[Content_Types].xml']=out['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
 out['word/_rels/document.xml.rels']=out['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
 out['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat>'+('' if flag is None else f'<w:suppressSpBfAfterPgBrk w:val="{int(flag)}"/>')+f'<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'
 target=ROOT/f'public/fixtures/leading-break-spacing-{name}.docx'
 with ZipFile(target,'w',ZIP_DEFLATED) as z:
  for path,data in out.items():z.writestr(ZipInfo(path,(2026,9,18,0,0,0)),data,compress_type=ZIP_DEFLATED)
 print(target)
refs=ROOT/'tests/fixtures/leading-break-spacing';refs.mkdir(exist_ok=True)
(refs/'cases.json').write_text(json.dumps(dict(cases=cases,variants=variants),indent=2)+'\n')
