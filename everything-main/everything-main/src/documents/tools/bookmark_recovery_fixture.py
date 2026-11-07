"""Independent mixed valid/invalid bookmark ranges in a rich document.

The orphan, duplicate and reversed endpoints are deliberate semantic errors;
passing the schemas does not make those ranges conformant.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/bookmark-recovery'


def start(number, name):
    return f'<w:bookmarkStart w:id="{number}" w:name="{name}"/>'


def end(number):
    return f'<w:bookmarkEnd w:id="{number}"/>'


def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'orphan-start', 'orphan-end', 'reversed', 'duplicate-start', 'duplicate-end', 'unpaired-columns', 'combined']:
        parts = dict(original)
        doc = parts['word/document.xml'].decode()
        doc = doc.replace('<w:body>', '<w:body>' + start(30, 'Across'))
        doc = doc.replace('<w:r><w:t>Styled heading', start(10, 'Heading') + end(10) + '<w:r><w:t>Styled heading')
        doc = doc.replace('<w:p>' + base.picture(2) + '</w:p>', '<w:p>' + base.picture(2) + '</w:p>' + end(30))
        doc = doc.replace(base.p('Retained table cell'), '<w:p>' + start(20, 'Cell') + '<w:r><w:t>Retained table cell</w:t></w:r>' + end(40) + end(20) + '</w:p>')
        before = after = ''
        if variant == 'orphan-start':
            before = start(99, 'Broken')
        elif variant == 'orphan-end':
            after = end(99)
        elif variant == 'reversed':
            before, after = end(99), start(99, 'Broken')
        elif variant == 'duplicate-start':
            before, after = start(99, 'Broken') + start(99, 'Ambiguous'), end(99)
        elif variant == 'duplicate-end':
            before, after = start(99, 'Broken'), end(99) + end(99)
        elif variant == 'unpaired-columns':
            before, after = '<w:bookmarkStart w:id="99" w:name="Broken" w:colFirst="0"/>', end(99)
        elif variant == 'combined':
            before, after = start(99, 'Broken'), end(98)
        shading = '<w:pPr><w:shd w:val="diagCross" w:color="000000" w:fill="FFFFFF"/></w:pPr>' if variant == 'combined' else ''
        middle = '<w:p>' + shading + start(40, 'Overlap') + before + '<w:r><w:t>Between the pictures</w:t></w:r>' + after + '</w:p>'
        doc = doc.replace(base.p('Between the pictures'), middle)
        link = '<w:p><w:hyperlink w:anchor="Cell"><w:r><w:t>Jump to cell</w:t></w:r></w:hyperlink></w:p>'
        doc = doc.replace('<w:sectPr>', link + '<w:sectPr>')
        parts['word/document.xml'] = doc.encode()
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                archive.writestr(name, data)


if __name__ == '__main__':
    main()
