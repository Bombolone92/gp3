"""Original minimal OOXML controls for unresolved w15 bindings; no source template."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
DS = 'http://schemas.openxmlformats.org/officeDocument/2006/customXml'
STORE = '{11111111-1111-4111-8111-111111111111}'
CASES = [
    ('Missing rich node', '/f:root/f:absent', False),
    ('Missing plain node', '/f:root/f:absent', True),
    ('Missing indexed rich node', '/f:root/f:value[2]', False),
]
paragraphs = []
for i, (title, xpath, plain) in enumerate(CASES, 1):
    paragraphs.append(f'''<w:p><w:r><w:t xml:space="preserve">{escape(title)}: </w:t></w:r>
      <w:sdt><w:sdtPr><w:alias w:val={quoteattr(title)}/><w:id w:val="{i}"/>
      <w15:dataBinding w:prefixMappings="xmlns:f='urn:binding-control'" w:xpath={quoteattr(xpath)}
       w:storeItemID="{{00000000-0000-0000-0000-000000000000}}"/>
      {'<w:text/>' if plain else ''}<w15:appearance w15:val="hidden"/>
      </w:sdtPr><w:sdtContent><w:r><w:t>Saved unresolved content {i}</w:t></w:r></w:sdtContent></w:sdt></w:p>''')
parts = {
    '[Content_Types].xml': f'''<Types xmlns="{CT}">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
      <Override PartName="/customXml/props.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>
      </Types>''',
    '_rels/.rels': f'<Relationships xmlns="{P}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': f'''<w:document xmlns:w="{W}" xmlns:w15="{W15}" xmlns:mc="{MC}" mc:Ignorable="w15">
      <w:body>{''.join(paragraphs)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
      </w:sectPr></w:body></w:document>''',
    'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
    'word/_rels/document.xml.rels': f'''<Relationships xmlns="{P}">
      <Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/>
      <Relationship Id="data" Type="{R}/customXml" Target="../customXml/data.xml"/></Relationships>''',
    'customXml/data.xml': '<q:root xmlns:q="urn:binding-control"><q:value>Existing mapped value</q:value></q:root>',
    'customXml/props.xml': f'<ds:datastoreItem xmlns:ds="{DS}" ds:itemID="{STORE}"><ds:schemaRefs/></ds:datastoreItem>',
    'customXml/_rels/data.xml.rels': f'<Relationships xmlns="{P}"><Relationship Id="props" Type="{R}/customXmlProps" Target="props.xml"/></Relationships>',
}
out = ROOT / 'public/fixtures/unresolved-bindings.docx'
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for name, text in parts.items():
        archive.writestr(name, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + text)
print(out)
