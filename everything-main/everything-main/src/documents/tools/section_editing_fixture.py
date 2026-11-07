"""Original OOXML controls for deleting and replacing section boundaries."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'


def section(index, inherited=False):
    width, height, left = [(12240, 15840, 1440), (15840, 12240, 720), (12240, 15840, 2160)][index]
    references = f'<w:headerReference w:type="default" r:id="header{index + 1}"/>'
    if inherited:
        references = (''.join(f'<w:{kind}Reference w:type="{variant}" r:id="{kind}{label}"/>'
                             for kind in ['header', 'footer']
                             for variant, label in [('default', '1'), ('first', 'First'), ('even', 'Even')]) if index == 0 else '')
    return (f'<w:sectPr>{references}'
            f'<w:type w:val="nextPage"/><w:pgSz w:w="{width}" w:h="{height}"'
            + (' w:orient="landscape"' if width > height else '') + '/>'
            f'<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="{left}" '
            'w:header="720" w:footer="720" w:gutter="0"/>' + ('<w:titlePg/>' if inherited else '') + '</w:sectPr>')


def paragraph(text, ending=None, alignment=None, inherited=False):
    properties = '<w:pPr><w:spacing w:after="0"/>' + (f'<w:jc w:val="{alignment}"/>' if alignment else '') + (section(ending, inherited) if ending is not None else '') + '</w:pPr>'
    return f'<w:p>{properties}<w:r><w:t>{text}</w:t></w:r></w:p>'


def generate(destination):
    destination.mkdir(parents=True, exist_ok=True)
    for name, table, formats in [('plain', False, False), ('table', True, False), ('formats', False, True), ('inheritance', False, True), ('implicit-final', False, True), ('boundary-table', True, True)]:
        inherited = name in ['inheritance', 'implicit-final']
        body = paragraph('Alpha first') + paragraph('Bravo boundary', 0, 'right' if formats else None, inherited)
        if name != 'boundary-table':
            body += paragraph('Charlie second', alignment='center' if formats else None)
        if table:
            body += ('<w:tbl><w:tblPr><w:tblW w:w="2880" w:type="dxa"/></w:tblPr>'
                     '<w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid><w:tr><w:tc>'
                     '<w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr>'
                     + paragraph('Table middle') + '</w:tc></w:tr></w:tbl>')
        body += paragraph('Delta boundary', 1, inherited=inherited) + paragraph('Echo final') + (section(2, inherited) if name != 'implicit-final' else '')
        parts = {
            '[Content_Types].xml': f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            f'<Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/>'
            f'<Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/>'
            + ''.join(f'<Override PartName="/word/header{i}.xml" ContentType="{CT}header+xml"/>' for i in range(1, 4)) + '</Types>',
            '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
            'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/>'
            + ''.join(f'<Relationship Id="header{i}" Type="{R}/header" Target="header{i}.xml"/>' for i in range(1, 4)) + '</Relationships>',
            'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr>'
            '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>'
            '<w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>',
            'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}</w:body></w:document>',
            **{f'word/header{i}.xml': f'<w:hdr xmlns:w="{W}">{paragraph("Header " + str(i))}</w:hdr>' for i in range(1, 4)},
        }
        if inherited:
            extra = [('header', 'First'), ('header', 'Even'), ('footer', '1'), ('footer', 'First'), ('footer', 'Even')]
            parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>',
                ''.join(f'<Override PartName="/word/{kind}{label}.xml" ContentType="{CT}{kind}+xml"/>' for kind, label in extra)
                + f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
            parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>',
                ''.join(f'<Relationship Id="{kind}{label}" Type="{R}/{kind}" Target="{kind}{label}.xml"/>' for kind, label in extra)
                + f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
            for kind, label in extra:
                tag = 'hdr' if kind == 'header' else 'ftr'
                parts[f'word/{kind}{label}.xml'] = f'<w:{tag} xmlns:w="{W}">{paragraph(kind.title() + " " + label)}</w:{tag}>'
            parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:evenAndOddHeaders/></w:settings>'
        with ZipFile(destination / f'{name}.docx', 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                archive.writestr(info, data.encode('utf-8'))


if __name__ == '__main__':
    generate(Path(__file__).resolve().parents[1] / 'tests/fixtures/section-editing')
