"""Original repeated-glyph controls for native advance quantization."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
from canvas_first_section_fixture import parts as base,R,CT,W
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/text-advance-grid'
folder.mkdir(parents=True,exist_ok=True)
cases=[];body=[]
for family in ['Franklin Gothic Book','Franklin Gothic Demi','Arial']:
    for bold in [False,True]:
        for glyph in ['a','n','i','W']:
            ident=len(cases)+1;text=glyph*20
            cases.append(dict(id=ident,family=family,bold=bold,glyph=glyph,text=text,sizePt=12))
            props=f'<w:rFonts w:ascii="{escape(family)}" w:hAnsi="{escape(family)}"/><w:b w:val="{int(bold)}"/><w:sz w:val="24"/><w:kern w:val="0"/>'
            body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="320" w:lineRule="exact"/></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r></w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>')
parts=dict(base)
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
with ZipFile(folder/'control.docx','w') as z:
    for name,data in parts.items():
        info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
