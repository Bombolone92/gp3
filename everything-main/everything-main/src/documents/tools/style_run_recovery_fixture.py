"""Original mixed-content controls for unsupported style-run properties."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/style-run-recovery'

def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'defaults', 'named', 'conditional', 'combined']:
        parts = dict(original)
        bad = '<w:shd w:val="pct20" w:color="000000" w:fill="FFFFFF"/>'
        def extra(kind): return bad if variant in [kind, 'combined'] else ''
        styles = f'''<w:styles xmlns:w="{base.W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:color w:val="336699"/><w:sz w:val="22"/>{extra('defaults')}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="180"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading"><w:name w:val="Heading"/><w:rPr><w:b/><w:color w:val="204080"/><w:sz w:val="36"/>{extra('named')}</w:rPr></w:style>
<w:style w:type="table" w:styleId="Accent"><w:name w:val="Accent"/><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="803020"/>{extra('conditional')}</w:rPr></w:tblStylePr></w:style></w:styles>'''
        parts['word/styles.xml'] = styles.encode()
        parts['word/document.xml'] = parts['word/document.xml'].decode().replace('<w:tblPr>', '<w:tblPr><w:tblStyle w:val="Accent"/>').replace('</w:tblPr>', '<w:tblLook w:val="0020" w:firstRow="1"/></w:tblPr>').encode()
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items(): archive.writestr(name, data)

if __name__ == '__main__': main()
