"""Original mixed-content controls for unsupported hyperlink destinations."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/hyperlink-recovery'


def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'location', 'missing', 'unsafe']:
        parts = dict(original)

        def paragraph(number):
            props = '<w:rPr><w:b/><w:color w:val="803020"/><w:sz w:val="28"/></w:rPr>'
            picture = base.picture(number).replace(f'r:embed="image{number}"', 'r:embed="image1"')
            content = f'<w:r>{props}<w:t>Linked {number}</w:t></w:r>{picture}<w:r>{props}<w:t>After picture</w:t></w:r>'
            attributes = 'r:id="link"' + (' w:docLocation="table"' if variant == 'location' else '')
            # Healthy control is the visible content without an interactive wrapper.
            if variant != 'healthy':
                content = f'<w:hyperlink {attributes}>{content}</w:hyperlink>'
            return f'<w:p><w:pPr><w:spacing w:after="240"/><w:ind w:left="360"/></w:pPr><w:r><w:t xml:space="preserve">Before </w:t></w:r>{content}<w:r><w:t xml:space="preserve"> End</w:t></w:r></w:p>'

        parts['word/document.xml'] = parts['word/document.xml'].decode().replace('<w:p>' + base.picture(1) + '</w:p>', paragraph(10)).replace('<w:p>' + base.picture(2) + '</w:p>', '').replace(base.p('Retained table cell'), paragraph(20)).encode()
        parts['word/header1.xml'] = f'<w:hdr xmlns:w="{base.W}" xmlns:r="{base.R}" xmlns:a="{base.A}" xmlns:wp="{base.WP}" xmlns:pic="{base.PIC}">{base.p("Retained header")}{paragraph(30)}</w:hdr>'.encode()
        target = 'javascript:alert(1)' if variant == 'unsafe' else 'https://example.com/document.docx'
        link = '' if variant in ['healthy', 'missing'] else f'<Relationship Id="link" Type="{base.R}/hyperlink" Target="{target}" TargetMode="External"/>'
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>', link + '</Relationships>').encode()
        parts['word/_rels/header1.xml.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="{base.R}/image" Target="media/image1.png"/>{link}</Relationships>'.encode()
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                archive.writestr(name, data)


if __name__ == '__main__':
    main()
