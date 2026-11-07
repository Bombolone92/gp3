from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from html import escape
import json
out=Path(__file__).resolve().parents[1]/'public/fixtures'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'
O='http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
sizes=[n/2 for n in range(2,50)]+[30,36,48,72,96,144]
cases=[];paras=[]
for font in ['Times New Roman','Arial','Calibri']:
 for size in sizes:
  case={'id':f'K{len(cases)+1:03}','font':font,'size':size};cases.append(case)
  label=f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">{case["id"]} </w:t></w:r>'
  props=f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/><w:smallCaps/><w:sz w:val="{int(size*2)}"/>'
  paras.append('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="'+str(int(max(14,size+5)*20))+'" w:lineRule="exact"/></w:pPr>'+label+'<w:r><w:rPr>'+props+'</w:rPr><w:t>AaBbéΣσЖж9!?</w:t></w:r></w:p>')
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>', '_rels/.rels':f'<Relationships xmlns="{R}"><Relationship Id="rDoc" Type="{O}officeDocument" Target="word/document.xml"/></Relationships>', 'word/_rels/document.xml.rels':f'<Relationships xmlns="{R}"><Relationship Id="rSettings" Type="{O}settings" Target="settings.xml"/></Relationships>', 'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>', 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+''.join(paras)+'<w:sectPr><w:pgSz w:w="24480" w:h="15840" w:orient="landscape"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'}
with ZipFile(out/'small-caps-sizes.docx','w',ZIP_DEFLATED) as z:
 for n,s in parts.items():z.writestr(n,s)
(out.parent.parent/'tests/fixtures/small-caps-sizes/cases.json').write_text(json.dumps(cases,indent=2)+'\n')
