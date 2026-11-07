"""Original paired controls for local text-clearing-break preview recovery.

The matched control changes only br/@clear to none. All XML and PNG artwork
are authored locally; the standard-library generator uses no document engine.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/clearing-break-recovery'


def build():
    with TemporaryDirectory() as temporary:
        base.OUT = Path(temporary)
        base.build(False)
        with ZipFile(base.OUT / 'healthy.docx') as archive:
            original = {name: archive.read(name) for name in archive.namelist()}
    OUT.mkdir(parents=True, exist_ok=True)
    for position in ['before', 'after', 'both']:
        for clear in ['none', 'left', 'right', 'all']:
            parts = dict(original)

            def paragraph(number):
                props = '<w:rPr><w:b/><w:color w:val="803020"/><w:sz w:val="28"/></w:rPr>'
                picture = base.picture(number).replace(f'r:embed="image{number}"', 'r:embed="image1"')[5:-6]
                br = f'<w:br w:type="textWrapping" w:clear="{clear}"/>'
                before = br if position in ['before', 'both'] else ''
                after = br if position in ['after', 'both'] else ''
                # A supported picture shares the failing run; additional healthy
                # runs share its hyperlink. Recovery must retain both boundaries.
                linked = f'<w:r>{props}<w:t>Linked {number}</w:t>{before}{picture}{after}<w:t>After picture</w:t></w:r>'
                linked += '<w:r><w:rPr><w:i/></w:rPr><w:t>Linked tail</w:t></w:r>'
                return f'<w:p><w:pPr><w:spacing w:after="240"/><w:ind w:left="360"/></w:pPr><w:r><w:t xml:space="preserve">Before </w:t></w:r><w:hyperlink r:id="link">{linked}</w:hyperlink><w:r><w:t xml:space="preserve"> End</w:t></w:r></w:p>'

            parts['word/document.xml'] = parts['word/document.xml'].decode().replace('<w:p>' + base.picture(1) + '</w:p>', paragraph(10)).replace('<w:p>' + base.picture(2) + '</w:p>', '').replace(base.p('Retained table cell'), paragraph(20)).replace('<w:pgSz', '<w:footerReference w:type="default" r:id="footer"/><w:pgSz').encode()
            namespaces = f'xmlns:w="{base.W}" xmlns:r="{base.R}" xmlns:a="{base.A}" xmlns:wp="{base.WP}" xmlns:pic="{base.PIC}"'
            for kind, root, number in [('header', 'hdr', 30), ('footer', 'ftr', 40)]:
                parts[f'word/{kind}1.xml'] = f'<w:{root} {namespaces}>{paragraph(number)}</w:{root}>'.encode()
                parts[f'word/_rels/{kind}1.xml.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="{base.R}/image" Target="media/image1.png"/><Relationship Id="link" Type="{base.R}/hyperlink" Target="https://example.com/retained" TargetMode="External"/></Relationships>'.encode()
            relationships = f'<Relationship Id="link" Type="{base.R}/hyperlink" Target="https://example.com/retained" TargetMode="External"/><Relationship Id="footer" Type="{base.R}/footer" Target="footer1.xml"/>'
            parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>', relationships + '</Relationships>').encode()
            parts['[Content_Types].xml'] = parts['[Content_Types].xml'].decode().replace('</Types>', '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>').encode()
            with ZipFile(OUT / f'{position}-{clear}.docx', 'w', ZIP_DEFLATED) as archive:
                for name, data in parts.items():
                    archive.writestr(name, data)


if __name__ == '__main__':
    build()
