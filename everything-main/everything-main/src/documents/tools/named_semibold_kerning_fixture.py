"""Original controls for named non-400 faces; no font binaries are embedded."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json, sys

folder=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'tests/fixtures/named-semibold-kerning'
folder.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
cases=[dict(family=family,bold=bold,italic=italic,spacing=spacing/20,kerning=kern/2,text='AVATARLY CONTACT')
       for family in ['Open Sans SemiBold','Open Sans Light'] for italic in [False,True]
       for bold in [False,True] for spacing in [0,10] for kern in [0,2]]
body=''.join(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="380" w:lineRule="exact"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="{c["family"]}" w:hAnsi="{c["family"]}"/>'
    +('<w:b/>' if c['bold'] else '')+('<w:i/>' if c['italic'] else '')
    +f'<w:spacing w:val="{round(c["spacing"]*20)}"/><w:kern w:val="{round(c["kerning"]*2)}"/><w:sz w:val="24"/><w14:ligatures w14:val="none"/></w:rPr><w:t>{c["text"]}</w:t></w:r></w:p>' for c in cases)
for enabled in [0,1]:
    parts={
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
      '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>',
      'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>',
      'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/><w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="{enabled}"/></w:compat></w:settings>',
    }
    with ZipFile(folder/f'control-{enabled}.docx','w') as archive:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,10,1,12,0,0));info.create_system=0;info.external_attr=0o600<<16
            archive.writestr(info,data.encode(),compress_type=ZIP_DEFLATED)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
