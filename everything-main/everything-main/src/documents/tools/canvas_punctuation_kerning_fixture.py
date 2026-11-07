"""Independent OPC/XML controls for noPunctuationKerning."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from html import escape
import json
out=Path(__file__).resolve().parents[1]/'public/fixtures'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'
O='http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
strings=['AVATAR','To','T.A','T,A','T:A','T;A','T!A','T?A','T’A','T“A','(AV)','[AV]','A-V','A—V','A…V','A/V','A\\V','A_V','A+V','A$V','A%V','A&V','A=V','A|V']
cases=[]
for font in ['Times New Roman','Arial']:
 for text in strings:cases.append({'id':f'K{len(cases)+1:02}','font':font,'text':text,'kern':2})
for text in ['AVATAR','T.A','T,A','T’A']:cases.append({'id':f'K{len(cases)+1:02}','font':'Times New Roman','text':text,'kern':0})
paras=[]
for c in cases:
 fmt=f'<w:rFonts w:ascii="{c["font"]}" w:hAnsi="{c["font"]}"/><w:kern w:val="{c["kern"]}"/><w:sz w:val="48"/>'
 paras.append('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="600" w:lineRule="exact"/></w:pPr><w:r><w:rPr>'+fmt+'</w:rPr><w:t xml:space="preserve">'+escape(c['id']+' '+c['text']+' |')+'</w:t></w:r></w:p>')
for flag in ['on','off','omitted']:
 settings='<w:settings xmlns:w="'+W+'">'+('' if flag=='omitted' else '<w:noPunctuationKerning w:val="'+('1' if flag=='on' else '0')+'"/>')+'<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
 parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="{R}"><Relationship Id="rDoc" Type="{O}officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':f'<Relationships xmlns="{R}"><Relationship Id="rSettings" Type="{O}settings" Target="settings.xml"/></Relationships>',
 'word/settings.xml':settings,
 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+''.join(paras)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'}
 with ZipFile(out/f'punctuation-kerning-{flag}.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items():z.writestr(name,data)
(out.parent.parent/'tests/fixtures/punctuation-kerning/punctuation-kerning-cases.json').write_text(json.dumps(cases,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
