"""Original controls for localized paragraph-property recovery in styles."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/style-paragraph-recovery'

def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'defaults', 'named', 'conditional', 'combined']:
        parts = dict(original)
        def props(kind):
            bad = '<w:shd w:val="diagCross" w:color="000000" w:fill="FFFFFF"/>' if variant in [kind, 'combined'] else ''
            extra = '<w:jc w:val="right"/>' if kind == 'conditional' else ''
            return f'<w:pPr>{bad}<w:spacing w:after="240" w:line="300" w:lineRule="auto"/><w:ind w:left="360"/>{extra}</w:pPr>'
        styles = f'''<w:styles xmlns:w="{base.W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:color w:val="336699"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault>{props('defaults')}</w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading"><w:name w:val="Heading"/>{props('named')}<w:rPr><w:b/><w:color w:val="204080"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="Accent"><w:name w:val="Accent"/><w:tblStylePr w:type="firstRow">{props('conditional')}<w:rPr><w:b/><w:color w:val="803020"/></w:rPr></w:tblStylePr></w:style></w:styles>'''
        parts['word/styles.xml'] = styles.encode()
        parts['word/document.xml'] = parts['word/document.xml'].decode().replace('<w:tblPr>', '<w:tblPr><w:tblStyle w:val="Accent"/>').replace('</w:tblPr>', '<w:tblLook w:val="0020" w:firstRow="1"/></w:tblPr>').encode()
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items(): archive.writestr(name, data)

if __name__ == '__main__': main()
