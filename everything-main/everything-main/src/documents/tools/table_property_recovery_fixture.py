"""Independent OOXML controls for table-property recovery, without an editor engine."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/table-property-recovery'


def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as source:
        parts = {name: source.read(name) for name in source.namelist()}
    document = parts['word/document.xml'].decode('utf-8')
    variants = {
        'table-bidi': ('<w:tblPr>', '<w:tblPr><w:bidiVisual/>'),
        'row-revision': ('<w:tr>', '<w:tr><w:trPr><w:ins w:author="Fixture" w:id="1" w:date="2026-09-29T00:00:00Z"/></w:trPr>'),
        'cell-fit': ('</w:tcPr>', '<w:tcFitText/></w:tcPr>'),
        'table-spacing': ('<w:tblLayout', '<w:tblCellSpacing w:w="120" w:type="dxa"/><w:tblLayout'),
    }
    documents = {name: document.replace(old, new, 1) for name, (old, new) in variants.items()}
    combined = document
    for old, new in list(variants.values())[:3]:
        combined = combined.replace(old, new, 1)
    documents['combined'] = combined
    documents['style-cell-fit'] = document.replace('<w:tblPr>', '<w:tblPr><w:tblStyle w:val="RecoveryTable"/>', 1)
    documents['conditional-cell-fit'] = documents['style-cell-fit'].replace('</w:tblPr>', '<w:tblLook w:firstRow="1"/></w:tblPr>', 1)
    documents['style-supported'] = documents['style-cell-fit']
    documents['conditional-supported'] = documents['conditional-cell-fit']
    styles = parts['word/styles.xml'].decode('utf-8')
    style = '<w:style w:type="table" w:styleId="RecoveryTable"><w:name w:val="Recovery table"/>{}</w:style>'
    base_properties = '<w:tcPr><w:tcFitText/></w:tcPr>'
    conditional = '<w:tblStylePr w:type="firstRow"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="CCEEFF"/><w:tcFitText/></w:tcPr></w:tblStylePr>'
    for name, content in documents.items():
        with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as target:
            for path, data in parts.items():
                if path == 'word/document.xml':
                    data = content.encode('utf-8')
                elif path == 'word/styles.xml' and name in ['style-cell-fit', 'conditional-cell-fit', 'style-supported', 'conditional-supported']:
                    properties = base_properties if name.startswith('style-') else conditional
                    if name.endswith('-supported'):
                        properties = properties.replace('<w:tcFitText/>', '')
                    data = styles.replace('</w:styles>', style.format(properties) + '</w:styles>').encode('utf-8')
                target.writestr(path, data)


if __name__ == '__main__':
    main()
