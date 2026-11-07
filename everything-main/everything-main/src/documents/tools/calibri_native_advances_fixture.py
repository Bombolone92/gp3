"""Manually author word-grouping and OpenType advance holdouts."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from hashlib import sha256
import argparse
import json

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-folder', required=True, type=Path)
parser.add_argument('--open-type-features', action='store_true')
args=parser.parse_args()
root = args.output_folder
root.mkdir()
cases = []; paragraphs = []
texts=[]
for letter in 'aein':
    for group in [16,4,2,1]:
        texts.append(' '.join([letter*group]*(16//group)))
texts.extend(['aaaa,aaaa.aaaa/aaaa','aaaa|aaaa|aaaa|aaaa','aaaa\u00a0aaaa\u00a0aaaa\u00a0aaaa','alpha beta gamma delta epsilon'])
for text in texts:
    case=dict(index=len(cases),fontFamily='Calibri',fontSizePt=10,bold=False,text=text)
    cases.append(case)
    paragraphs.append('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b w:val="0"/><w:spacing w:val="0"/><w:kern w:val="0"/><w:sz w:val="20"/></w:rPr><w:t>'+text+'</w:t></w:r></w:p>')
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
r = 'http://schemas.openxmlformats.org/package/2006/relationships'
office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
    '_rels/.rels': f'<Relationships xmlns="{r}"><Relationship Id="rDoc" Type="{office}officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': f'<Relationships xmlns="{r}"><Relationship Id="rSettings" Type="{office}settings" Target="settings.xml"/></Relationships>',
    'word/settings.xml': f'<w:settings xmlns:w="{w}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
    'word/document.xml': f'<w:document xmlns:w="{w}"><w:body>{"".join(paragraphs)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
source = root/'control.docx'
if args.open_type_features:
    parts['word/settings.xml']=parts['word/settings.xml'].replace('</w:compat>', '<w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat>')
with ZipFile(source, 'x') as archive:
    for name, text in parts.items():
        info = ZipInfo(name, (2026, 10, 10, 0, 0, 0))
        info.create_system = 0; info.external_attr = 0o600 << 16
        archive.writestr(info, text.encode(), compress_type=ZIP_DEFLATED)
(root/'cases.json').write_text(json.dumps(cases, indent=2)+'\n')
print(json.dumps(dict(cases=len(cases), sourceSha256=sha256(source.read_bytes()).hexdigest())))
