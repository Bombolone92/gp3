"""Original transitional legacy-numbering probes, authored directly as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
cases = [
 ('Modern', '', 'nothing', 'left', 720, 360),
 ('Off', 'w:legacy="off" w:legacyIndent="960" w:legacySpace="240"', 'nothing', 'left', 720, 360),
 ('On', 'w:legacy="on" w:legacyIndent="960" w:legacySpace="240"', 'nothing', 'left', 720, 360),
 ('Implicit', 'w:legacyIndent="960" w:legacySpace="240"', 'nothing', 'left', 720, 360),
 ('Zero', 'w:legacy="1" w:legacyIndent="360" w:legacySpace="0"', 'tab', 'left', 720, 360),
 ('Tab', 'w:legacy="1" w:legacyIndent="960" w:legacySpace="240"', 'tab', 'left', 720, 360),
 ('Space', 'w:legacy="1" w:legacyIndent="960" w:legacySpace="240"', 'space', 'left', 720, 360),
 ('Missing', 'w:legacy="1"', 'nothing', 'left', 720, 360),
 ('Negative', 'w:legacy="1" w:legacyIndent="-360" w:legacySpace="120"', 'nothing', 'left', 720, 360),
 ('Right', 'w:legacy="1" w:legacyIndent="960" w:legacySpace="240"', 'nothing', 'right', 720, 360),
 ('Center', 'w:legacy="1" w:legacyIndent="960" w:legacySpace="240"', 'nothing', 'center', 720, 360),
 ('Different', 'w:legacy="1" w:legacyIndent="960" w:legacySpace="240"', 'nothing', 'left', 1440, 720),
 ('NoModernIndent', 'w:legacy="1" w:legacyIndent="960" w:legacySpace="240"', 'nothing', 'left', None, None),
 ('ZeroIndent', 'w:legacy="1" w:legacyIndent="0" w:legacySpace="240"', 'nothing', 'left', 720, 360),
 ('LargeSpace', 'w:legacy="1" w:legacyIndent="960" w:legacySpace="1200"', 'nothing', 'left', 720, 360),
 ('NoSpace', 'w:legacy="1" w:legacyIndent="960"', 'nothing', 'left', 720, 360),
 ('ShortIndent', 'w:legacy="1" w:legacyIndent="120" w:legacySpace="240"', 'nothing', 'left', 720, 360),
 ('RightZero', 'w:legacy="1" w:legacyIndent="360" w:legacySpace="0"', 'nothing', 'right', 720, 360),
 ('CenterZero', 'w:legacy="1" w:legacyIndent="360" w:legacySpace="0"', 'nothing', 'center', 720, 360),
 ('SpaceOnly', 'w:legacy="1" w:legacySpace="240"', 'nothing', 'left', 720, 360),
 ('NoGeometry', 'w:legacy="1"', 'nothing', 'left', None, None),
 ('RightShort', 'w:legacy="1" w:legacyIndent="120" w:legacySpace="240"', 'nothing', 'right', 720, 360),
 ('CenterShort', 'w:legacy="1" w:legacyIndent="120" w:legacySpace="240"', 'nothing', 'center', 720, 360),
 ('NegativeRight', 'w:legacy="1" w:legacyIndent="-360" w:legacySpace="120"', 'nothing', 'right', 720, 360),
]
body = ''; abstracts = ''; instances = ''
for i, (name, attributes, suffix, alignment, left, hanging) in enumerate(cases, 1):
    legacy = f'<w:legacy {attributes}/>' if attributes else ''
    ind = f'<w:ind w:left="{left}" w:hanging="{hanging}"/>' if left is not None else ''
    abstracts += f'<w:abstractNum w:abstractNumId="{i}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:suff w:val="{suffix}"/><w:lvlText w:val="%1."/>{legacy}<w:lvlJc w:val="{alignment}"/><w:pPr>{ind}</w:pPr></w:lvl></w:abstractNum>'
    instances += f'<w:num w:numId="{i}"><w:abstractNumId w:val="{i}"/></w:num>'
    body += f'<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="{i}"/></w:numPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>{name} sample text</w:t></w:r></w:p>'
parts = {
 '[Content_Types].xml': f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + ''.join(f'<Override PartName="/word/{part}.xml" ContentType="{CT}{kind}+xml"/>' for part,kind in [('document','document.main'),('styles','styles'),('numbering','numbering')]) + '</Types>',
 '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/><Relationship Id="numbering" Type="{R}/numbering" Target="numbering.xml"/></Relationships>',
 'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
 'word/numbering.xml': f'<w:numbering xmlns:w="{W}">{abstracts}{instances}</w:numbering>',
 'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
path = Path(__file__).resolve().parents[1] / 'public/fixtures/legacy-numbering.docx'
with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
    for name, xml in parts.items(): archive.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + xml)
print(path)
