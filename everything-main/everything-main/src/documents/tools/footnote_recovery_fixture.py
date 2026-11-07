"""Original mixed-content controls for unsupported footnote restart recovery.

Reuses our healthy picture/table/header/numbering control; no document engine.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/footnote-recovery'


def build():
    with TemporaryDirectory() as temporary:
        previous = base.OUT
        try:
            base.OUT = Path(temporary)
            base.build(False)
            with ZipFile(base.OUT / 'healthy.docx') as archive:
                source = {name: archive.read(name) for name in archive.namelist()}
        finally:
            base.OUT = previous
    OUT.mkdir(parents=True, exist_ok=True)
    cases = [(restart, restart, 'decimal') for restart in ['continuous', 'eachPage', 'eachSect']]
    cases += [('chicago', 'continuous', 'chicago'), ('ordinal', 'continuous', 'ordinal'), ('chicago-eachPage', 'eachPage', 'chicago')]
    for name, restart, format in cases:
        parts = source.copy()
        body = parts['word/document.xml'].decode()
        reference = lambda i: f'<w:r><w:footnoteReference w:id="{i}"/></w:r>'
        body = body.replace('<w:sectPr>', '<w:p><w:r><w:t>First annotated claim</w:t></w:r>' + reference(1) + '</w:p><w:p><w:r><w:br w:type="page"/><w:t>Second annotated claim</w:t></w:r>' + reference(2) + '</w:p><w:sectPr>')
        parts['word/document.xml'] = body.encode()
        parts['word/footnotes.xml'] = (f'<w:footnotes xmlns:w="{base.W}">' + ''.join(f'<w:footnote w:id="{i}"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Retained source {i}.</w:t></w:r></w:p></w:footnote>' for i in [1, 2]) + '</w:footnotes>').encode()
        parts['word/settings.xml'] = f'<w:settings xmlns:w="{base.W}"><w:footnotePr><w:numFmt w:val="{format}"/><w:numStart w:val="3"/><w:numRestart w:val="{restart}"/></w:footnotePr></w:settings>'.encode()
        relationships = ''.join(f'<Relationship Id="{name}" Type="{base.R}/{name}" Target="{name}.xml"/>' for name in ['footnotes', 'settings'])
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace(b'</Relationships>', (relationships + '</Relationships>').encode())
        overrides = ''.join(f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{name}+xml"/>' for name in ['footnotes', 'settings'])
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(b'</Types>', (overrides + '</Types>').encode())
        with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                archive.writestr(info, data)


if __name__ == '__main__':
    build()
