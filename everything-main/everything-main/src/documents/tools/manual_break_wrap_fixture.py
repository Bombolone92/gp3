"""Independent rich-content controls for wrapping/manual-break recovery."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from top_bottom_flow_fixture import make, drawing, paragraph, W, WP, A, PIC, R

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/manual-break-wrap'
NS = f'xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'

def content(matched=False):
    def anchor(number):
        picture = drawing(number, 30, 12)
        if matched:
            picture = picture.replace('<wp:wrapTopAndBottom/>', '<wp:wrapNone/>')
        rich = '<w:r><w:rPr><w:b/><w:color w:val="1E5A78"/></w:rPr><w:t>Before break</w:t><w:br/><w:t>After break</w:t></w:r>'
        return paragraph(drawings=picture + rich)
    table = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' + paragraph('Healthy table cell') + '</w:tc></w:tr></w:tbl>'
    return (paragraph('Healthy heading') + anchor(1) + paragraph('Healthy middle', before=500)
        + table + paragraph('Healthy wrapping', drawings=drawing(2, 8, 12))
        + paragraph('Healthy following', before=500) + anchor(3) + paragraph('Healthy ending', before=500))

def build():
    OUT.mkdir(parents=True, exist_ok=True)
    for scope in ['body', 'header', 'footer']:
        for matched in [False, True]:
            parts = make(15)
            story = scope if scope != 'body' else 'header'
            parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/{story}.xml" ContentType="{CT}{story}+xml"/></Types>')
            parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="story" Type="{R}/{story}" Target="{story}.xml"/></Relationships>')
            parts[f'word/_rels/{story}.xml.rels'] = f'<Relationships xmlns="{REL}"><Relationship Id="picture" Type="{R}/image" Target="media/panel.png"/></Relationships>'
            tag = 'hdr' if story == 'header' else 'ftr'
            parts[f'word/{story}.xml'] = f'<w:{tag} {NS}>' + (paragraph('Healthy header') if scope == 'body' else content(matched)) + f'</w:{tag}>'
            body = content(matched) if scope == 'body' else paragraph('Healthy body') + paragraph('Body picture', drawings=drawing(10, 8, 12)) + paragraph('Healthy ending', before=500)
            section = f'<w:sectPr><w:{story}Reference w:type="default" r:id="story"/><w:pgSz w:w="12240" w:h="24480"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
            parts['word/document.xml'] = f'<w:document {NS}><w:body>{body}{section}</w:body></w:document>'
            with ZipFile(OUT / f'{scope}-{"matched" if matched else "unsupported"}.docx', 'w') as archive:
                for name, data in parts.items():
                    info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                    info.compress_type = ZIP_DEFLATED
                    archive.writestr(info, data)

if __name__ == '__main__':
    build()
