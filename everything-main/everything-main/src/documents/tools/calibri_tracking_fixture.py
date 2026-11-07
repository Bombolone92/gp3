from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from hashlib import sha256
import json
import argparse
parser=argparse.ArgumentParser(description='Author independent all-caps/tracking OOXML control; requires a fresh output folder')
parser.add_argument('--output-folder',required=True,type=Path)
root=parser.parse_args().output_folder
root.mkdir()
cases=[];paragraphs=[]
for size in [36]:
 for bold in [True]:
  for kern in [14]:
   for caps,spacing in [(False,0),(True,0),(False,1),(True,1)]:
    case={'index':len(cases),'text':('Daring Alpha Beta' if caps else 'DARING ALPHA BETA'),'caps':caps,'fontFamily':'Calibri','fontSize':size,'bold':bold,'kerningPt':kern,'characterSpacingPt':spacing}
    cases.append(case)
    props=f'<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b w:val="{int(bold)}"/><w:caps w:val="{int(caps)}"/><w:spacing w:val="{spacing*20}"/><w:kern w:val="{kern*2}"/><w:sz w:val="{size*2}"/>'
    paragraphs.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="{(size+12)*20}" w:lineRule="exact"/></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{case["text"]}</w:t></w:r></w:p>')
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';rels='http://schemas.openxmlformats.org/package/2006/relationships';office='http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="{rels}"><Relationship Id="rDoc" Type="{office}officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':f'<Relationships xmlns="{rels}"><Relationship Id="rSettings" Type="{office}settings" Target="settings.xml"/></Relationships>',
 'word/settings.xml':f'<w:settings xmlns:w="{w}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/><w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat></w:settings>',
 'word/document.xml':f'<w:document xmlns:w="{w}"><w:body>{"".join(paragraphs)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>'}
source=root/'control.docx'
with ZipFile(source,'x') as out:
 for name,text in parts.items():
  info=ZipInfo(name,(2026,10,10,0,0,0));info.create_system=0;info.external_attr=0o600<<16
  out.writestr(info,text.encode(),compress_type=ZIP_DEFLATED)
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print(json.dumps({'sourceSha256':sha256(source.read_bytes()).hexdigest(),'cases':len(cases)}))
