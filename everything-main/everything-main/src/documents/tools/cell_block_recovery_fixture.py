"""Original cell-block recovery controls using standard-library OOXML construction."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base
OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-block-recovery'

def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as z:
        parts = {name: z.read(name) for name in z.namelist()}
    original = parts['word/document.xml'].decode()
    for nested in [False, True]:
        for broken in [False, True]:
            paragraphs = base.p('Before failed block', '<w:pPr><w:pStyle w:val="Heading"/></w:pPr>')
            paragraphs += base.p('Recovered paragraph', '<w:pPr><w:pageBreakBefore/></w:pPr>' if broken else '')
            paragraphs += base.p('After failed block')
            if nested:
                paragraphs = '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' + paragraphs + '</w:tc></w:tr></w:tbl>' + base.p('Outer cell tail')
            document = original.replace(base.p('Retained table cell'), paragraphs)
            name = ('nested-' if nested else '') + ('unsupported' if broken else 'healthy')
            with ZipFile(OUT / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
                for path, data in parts.items():
                    z.writestr(path, document.encode() if path == 'word/document.xml' else data)
if __name__ == '__main__':
    main()
