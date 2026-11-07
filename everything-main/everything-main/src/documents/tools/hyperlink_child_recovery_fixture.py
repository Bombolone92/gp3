"""Independent hyperlink controls with unsupported zero-width child structures.

Original text, XML and PNG pixels; Python standard library only.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/hyperlink-child-recovery'


def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'leading', 'trailing', 'multiple', 'deleted']:
        parts = dict(original)

        def paragraph(number):
            props = '<w:rPr><w:b/><w:color w:val="803020"/><w:sz w:val="28"/></w:rPr>'
            text = lambda value: f'<w:r>{props}<w:t>{value}</w:t></w:r>'
            picture = base.picture(number).replace(f'r:embed="image{number}"', 'r:embed="image1"')
            def permission(index):
                return f'<w:permStart w:id="{number + index}" w:edGrp="everyone"/><w:permEnd w:id="{number + index}"/>'
            before = permission(1) if variant in ['leading', 'multiple'] else ''
            middle = permission(2) if variant == 'multiple' else ''
            after = permission(3) if variant in ['trailing', 'multiple'] else ''
            if variant == 'deleted':
                before = f'<w:del w:id="{number}" w:author="Fixture author"><w:r><w:delText>Deleted text</w:delText></w:r></w:del>'
                after = f'<w:del w:id="{number + 1}" w:author="Fixture author"><w:r><w:delText>Also deleted</w:delText></w:r></w:del>'
            content = before + text(f'Linked {number}') + middle + picture + text('After picture') + after
            return f'<w:p><w:pPr><w:spacing w:after="240"/><w:ind w:left="360"/></w:pPr><w:r><w:t xml:space="preserve">Before </w:t></w:r><w:hyperlink r:id="link">{content}</w:hyperlink><w:r><w:t xml:space="preserve"> End</w:t></w:r></w:p>'

        parts['word/document.xml'] = parts['word/document.xml'].decode().replace('<w:p>' + base.picture(1) + '</w:p>', paragraph(10)).replace('<w:p>' + base.picture(2) + '</w:p>', '').replace(base.p('Retained table cell'), paragraph(20)).replace('<w:pgSz', '<w:footerReference w:type="default" r:id="footer"/><w:pgSz').encode()
        namespaces = f'xmlns:w="{base.W}" xmlns:r="{base.R}" xmlns:a="{base.A}" xmlns:wp="{base.WP}" xmlns:pic="{base.PIC}"'
        for kind, root, number in [('header', 'hdr', 30), ('footer', 'ftr', 40)]:
            parts[f'word/{kind}1.xml'] = f'<w:{root} {namespaces}>{paragraph(number)}</w:{root}>'.encode()
            parts[f'word/_rels/{kind}1.xml.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="{base.R}/image" Target="media/image1.png"/><Relationship Id="link" Type="{base.R}/hyperlink" Target="https://example.com/retained" TargetMode="External"/></Relationships>'.encode()
        relationships = f'<Relationship Id="link" Type="{base.R}/hyperlink" Target="https://example.com/retained" TargetMode="External"/><Relationship Id="footer" Type="{base.R}/footer" Target="footer1.xml"/>'
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>', relationships + '</Relationships>').encode()
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].decode().replace('</Types>', '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>').encode()
        with ZipFile(OUT / f'{variant}.docx', 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                archive.writestr(name, data)


if __name__ == '__main__':
    main()
