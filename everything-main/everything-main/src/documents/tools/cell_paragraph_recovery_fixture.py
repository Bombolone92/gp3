"""Original rich cell paragraphs with rejected paragraph page breaks."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-paragraph-recovery'


def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'first', 'second', 'inherited', 'story', 'combined', 'off']:
        parts = dict(original)
        def paragraph(text, number, affected=False):
            style = 'CellHeading' if variant == 'inherited' and affected else 'Heading'
            extra = '<w:pageBreakBefore/>' if affected and variant not in ['healthy', 'inherited', 'off'] else '<w:pageBreakBefore w:val="0"/>' if affected and variant == 'off' else ''
            picture = base.picture(number).replace(f'r:embed="image{number}"', 'r:embed="image1"')
            return f'<w:p><w:pPr><w:pStyle w:val="{style}"/>{extra}</w:pPr><w:r><w:t>{text}</w:t></w:r>{picture}</w:p>'
        first = variant not in ['second', 'story']
        cell = paragraph('Rich cell first', 3, first) + paragraph('Rich cell second', 4, variant == 'second')
        doc = parts['word/document.xml'].decode().replace(base.p('Retained table cell'), cell)
        if variant == 'combined':
            doc = doc.replace(base.p('Between the pictures'), base.p('Between the pictures', '<w:pPr><w:shd w:val="diagCross" w:color="000000" w:fill="FFFFFF"/></w:pPr>'))
        # A normal body page break remains effective in every variant.
        doc = doc.replace('<w:sectPr>', base.p('Unaffected body page break', '<w:pPr><w:pageBreakBefore/></w:pPr>') + '<w:sectPr>')
        parts['word/document.xml'] = doc.encode()
        style = '<w:style w:type="paragraph" w:styleId="CellHeading"><w:name w:val="Cell heading"/><w:basedOn w:val="Heading"/><w:pPr><w:pageBreakBefore/></w:pPr></w:style>'
        parts['word/styles.xml'] = parts['word/styles.xml'].decode().replace('</w:styles>', style + '</w:styles>').encode()
        header = paragraph('Rich header cell', 5, variant in ['story', 'combined'])
        table = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' + header + '</w:tc></w:tr></w:tbl>'
        parts['word/header1.xml'] = f'<w:hdr xmlns:w="{base.W}" xmlns:r="{base.R}" xmlns:wp="{base.WP}" xmlns:a="{base.A}" xmlns:pic="{base.PIC}">{table}{base.p("Header tail")}</w:hdr>'.encode()
        parts['word/_rels/header1.xml.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="{base.R}/image" Target="media/image1.png"/></Relationships>'.encode()
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                archive.writestr(name, data)

    # Also exercise the separately measured drawing-text story using the
    # project's existing independently authored native shape-table control.
    with ZipFile(OUT.parent / 'shape-tables/source.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['drawing-healthy', 'drawing-break']:
        parts = dict(original)
        if variant == 'drawing-break':
            before = b'<w:p><w:r><w:t>Merged heading'
            assert before in parts['word/document.xml']
            parts['word/document.xml'] = parts['word/document.xml'].replace(before, b'<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Merged heading', 1)
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                archive.writestr(name, data)


if __name__ == '__main__':
    main()
