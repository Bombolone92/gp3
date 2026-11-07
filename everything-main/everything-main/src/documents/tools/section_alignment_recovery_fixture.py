"""Original rich section controls for localized alignment previews."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/section-alignment-recovery'


def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['columns-top', 'columns-center', 'columns-bottom', 'columns-both', 'columns-combined', 'continuous-top', 'continuous-center']:
        parts = dict(original)
        document = parts['word/document.xml'].decode().replace('w:w="5000"', 'w:w="3000"')
        section = document[document.index('<w:sectPr>'):document.index('</w:sectPr>') + len('</w:sectPr>')]
        alignment = variant.split('-')[1]
        if alignment == 'combined':
            alignment = 'center'
            document = document.replace(base.p('Between the pictures'), base.p('Between the pictures', '<w:pPr><w:shd w:val="diagCross" w:color="000000" w:fill="FFFFFF"/></w:pPr>'))

        def settings(value, columns=False, continuous=False):
            result = section.replace('<w:pgSz', ('<w:type w:val="continuous"/>' if continuous else '') + '<w:pgSz')
            extra = '<w:cols w:num="2" w:space="720" w:sep="1"/>' if columns else ''
            return result.replace('</w:sectPr>', extra + f'<w:vAlign w:val="{value}"/></w:sectPr>')

        def boundary(properties):
            return f'<w:p><w:pPr>{properties}</w:pPr></w:p>'

        columns = variant.startswith('columns')
        if columns:
            document = document.replace('<w:p>' + base.picture(2) + '</w:p>', '<w:p><w:r><w:br w:type="column"/></w:r></w:p><w:p>' + base.picture(2) + '</w:p>')
        tail = boundary(settings(alignment, columns))
        if not columns:
            tail += base.p('Continuous second section', '<w:pPr><w:pStyle w:val="Heading"/></w:pPr>')
            tail += boundary(settings(alignment, continuous=True))
        tail += base.p('Unaffected centered section', '<w:pPr><w:pStyle w:val="Heading"/></w:pPr>') + settings('center')
        parts['word/document.xml'] = document.replace(section, tail).encode()
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                archive.writestr(name, data)
    # The imported base is a separate useful control, but is not part of this family.
    (OUT / 'healthy.docx').unlink()


if __name__ == '__main__':
    main()
