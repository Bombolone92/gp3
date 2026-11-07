"""Original same-run drawing-failure controls, including MCE branches."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/run-drawing-recovery'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'drawing', 'alternate', 'reserved']:
        parts = dict(original)
        def drawing(number):
            return base.picture(number).removeprefix('<w:r>').removesuffix('</w:r>').replace(f'r:embed="image{number}"', 'r:embed="image1"')
        def paragraph(number):
            bad = drawing(number + 1).replace('<a:blip r:embed="image1"/>', '<a:blip r:embed="image1"><a:alphaBiLevel thresh="50000"/></a:blip>')
            if variant == 'alternate':
                bad = f'<mc:AlternateContent xmlns:mc="{MC}"><mc:Choice Requires="a">{bad}</mc:Choice><mc:Fallback/></mc:AlternateContent>'
            if variant == 'healthy': bad = ''
            if variant == 'reserved': bad = drawing(number + 1)
            return f'<w:p><w:pPr><w:spacing w:after="240"/><w:ind w:left="360"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="803020"/><w:sz w:val="28"/></w:rPr><w:t>Start {number}</w:t>{drawing(number)}<w:t>Middle</w:t>{bad}<w:t>Following</w:t>{drawing(number + 2)}<w:t>End</w:t></w:r></w:p>'
        parts['word/document.xml'] = parts['word/document.xml'].decode().replace('<w:p>' + base.picture(1) + '</w:p>', paragraph(10)).replace('<w:p>' + base.picture(2) + '</w:p>', '').replace(base.p('Retained table cell'), paragraph(20)).encode()
        parts['word/header1.xml'] = f'<w:hdr xmlns:w="{base.W}" xmlns:r="{base.R}" xmlns:a="{base.A}" xmlns:wp="{base.WP}" xmlns:pic="{base.PIC}">{base.p("Retained header")}{paragraph(30)}</w:hdr>'.encode()
        parts['word/_rels/header1.xml.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="{base.R}/image" Target="media/image1.png"/></Relationships>'.encode()
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items(): archive.writestr(name, data)

if __name__ == '__main__': main()
