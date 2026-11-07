"""Original controls for containment of unsupported run children (ruby)."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import clearing_break_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/unknown-run-child-recovery'
RUBY = ('<w:ruby><w:rubyPr><w:rubyAlign w:val="center"/>'
        '<w:hps w:val="14"/><w:hpsRaise w:val="20"/>'
        '<w:hpsBaseText w:val="28"/><w:lid w:val="ja-JP"/></w:rubyPr>'
        '<w:rt><w:r><w:t>reading</w:t></w:r></w:rt>'
        '<w:rubyBase><w:r><w:t>BASE</w:t></w:r></w:rubyBase></w:ruby>')


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory() as temporary:
        base.OUT = Path(temporary)
        base.build()
        for position in ['before', 'after', 'both']:
            with ZipFile(base.OUT / f'{position}-none.docx') as archive:
                original = {n: archive.read(n) for n in archive.namelist()}
            for kind, replacement in [('unsupported', RUBY), ('matched', '<w:t>readingBASE</w:t>')]:
                parts = dict(original)
                for name in ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']:
                    parts[name] = parts[name].decode().replace('<w:br w:type="textWrapping" w:clear="none"/>', replacement).encode()
                with ZipFile(OUT / f'{position}-{kind}.docx', 'w') as archive:
                    for name, data in parts.items():
                        info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                        info.compress_type = ZIP_DEFLATED
                        archive.writestr(info, data)


if __name__ == '__main__':
    build()
