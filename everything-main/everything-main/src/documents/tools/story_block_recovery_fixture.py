"""Original header/footer block recovery controls, built with standard-library XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base
OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/story-block-recovery'
M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
def main():
    base.OUT = OUT; base.build(False)
    with ZipFile(OUT / 'healthy.docx') as z: parts = {n: z.read(n) for n in z.namelist()}
    document = parts['word/document.xml'].decode().replace('<w:pgSz', '<w:footerReference w:type="default" r:id="footer"/><w:pgSz', 1)
    parts['word/document.xml'] = document.encode()
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>', f'<Relationship Id="footer" Type="{base.R}/footer" Target="footer1.xml"/></Relationships>').encode()
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].decode().replace('</Types>', '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>').encode()
    math = '<m:oMathPara><m:oMath><m:r><m:t>x+y</m:t></m:r></m:oMath></m:oMathPara>'
    table = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>{}</w:tc></w:tr></w:tbl>'
    for name in ['healthy', 'header', 'footer', 'combined']:
        current = dict(parts)
        for kind, root in [('header', 'hdr'), ('footer', 'ftr')]:
            text = base.p('Healthy ' + kind, '<w:pPr><w:pStyle w:val="Heading"/></w:pPr>')
            if name in [kind, 'combined']: text += math
            text += table.format(base.p(kind + ' table')) + base.p('Retained ' + kind + ' tail')
            current[f'word/{kind}1.xml'] = f'<w:{root} xmlns:w="{base.W}" xmlns:m="{M}">{text}</w:{root}>'.encode()
        with ZipFile(OUT / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
            for path, data in current.items(): z.writestr(path, data)
if __name__ == '__main__': main()
