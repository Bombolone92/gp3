"""Original mixed-run symbol controls, including headers and footers."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import clearing_break_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/story-symbols'
CASES = [('before', 'Wingdings', 'F031'), ('after', 'Symbol', 'F0E3'), ('both', 'Arial', '0061')]


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory() as temporary:
        base.OUT = Path(temporary)
        base.build()
        for position, font, code in CASES:
            with ZipFile(base.OUT / f'{position}-none.docx') as archive:
                original = {n: archive.read(n) for n in archive.namelist()}
            props = '<w:b/><w:color w:val="803020"/><w:sz w:val="28"/>'
            for kind in ['symbol', 'literal']:
                parts = dict(original)
                marker = f'<w:sym w:font="{font}" w:char="{code}"/>'
                if kind == 'literal':
                    marker = f'</w:r><w:r><w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>{props}</w:rPr><w:t>{chr(int(code,16))}</w:t></w:r><w:r><w:rPr>{props}</w:rPr>'
                for name in ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']:
                    parts[name] = parts[name].decode().replace('<w:br w:type="textWrapping" w:clear="none"/>', marker).encode()
                with ZipFile(OUT / f'{position}-{kind}.docx', 'w') as archive:
                    for name, data in parts.items():
                        info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
                        archive.writestr(info, data)


if __name__ == '__main__':
    build()
