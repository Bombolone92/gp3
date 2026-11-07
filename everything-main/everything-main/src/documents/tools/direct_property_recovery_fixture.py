"""Original controls for direct-property recovery around text and pictures."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/direct-property-recovery'

def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'run', 'paragraph', 'mark', 'combined']:
        parts = dict(original)
        def bad(kind):
            pattern = 'diagCross' if kind == 'paragraph' else 'pct20'
            return f'<w:shd w:val="{pattern}" w:color="000000" w:fill="FFFFFF"/>' if variant in [kind, 'combined'] else ''
        def paragraph(number):
            mark = '<w:rPr><w:sz w:val="28"/>' + bad('mark') + '</w:rPr>'
            ppr = '<w:pPr>' + bad('paragraph') + '<w:spacing w:after="240"/><w:ind w:left="360"/>' + mark + '</w:pPr>'
            rpr = '<w:rPr><w:b/><w:color w:val="803020"/><w:sz w:val="28"/>' + bad('run') + '</w:rPr>'
            run = base.picture(number).replace(f'r:embed="image{number}"', 'r:embed="image1"')
            run = run.replace('<w:r>', f'<w:r>{rpr}<w:t xml:space="preserve">Before picture {number} </w:t>').replace('</w:r>', '<w:t xml:space="preserve"> after picture</w:t></w:r>')
            return '<w:p>' + ppr + run + '</w:p>'
        parts['word/document.xml'] = parts['word/document.xml'].decode().replace('<w:p>' + base.picture(1) + '</w:p>', paragraph(1)).replace(base.p('Retained table cell'), paragraph(3)).encode()
        header = f'<w:hdr xmlns:w="{base.W}" xmlns:r="{base.R}" xmlns:a="{base.A}" xmlns:wp="{base.WP}" xmlns:pic="{base.PIC}">{base.p("Retained header")}{paragraph(4)}</w:hdr>'
        parts['word/header1.xml'] = header.encode()
        parts['word/_rels/header1.xml.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="{base.R}/image" Target="media/image1.png"/></Relationships>'.encode()
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items(): archive.writestr(name, data)

if __name__ == '__main__': main()
