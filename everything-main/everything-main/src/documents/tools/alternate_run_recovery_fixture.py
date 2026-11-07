"""Original paired MC branch controls; no document engine or external artwork."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import clearing_break_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/alternate-run-recovery'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory() as temporary:
        base.OUT = Path(temporary)
        base.build()
        for position in ['before', 'after', 'both']:
            with ZipFile(base.OUT / f'{position}-none.docx') as archive:
                original = {n: archive.read(n) for n in archive.namelist()}
            for branch in ['choice', 'fallback', 'empty']:
                for kind in ['wrapped', 'matched']:
                    parts = dict(original)
                    for part, number in [('word/document.xml', 100), ('word/header1.xml', 200), ('word/footer1.xml', 300)]:
                        text = parts[part].decode()
                        marker = '<w:br w:type="textWrapping" w:clear="none"/>'
                        while marker in text:
                            number += 1
                            picture = base.base.picture(number).replace(f'r:embed="image{number}"', 'r:embed="image1"')[5:-6]
                            selected = '' if branch == 'empty' else '<w:t>Selected</w:t>' + picture + '<w:tab/><w:t>branch</w:t>'
                            if kind == 'matched':
                                replacement = selected
                            else:
                                requires = 'w' if branch == 'choice' else 'future'
                                choice = selected if branch == 'choice' else '<future:unknown/>'
                                fallback = '<w:t>UNSELECTED</w:t>' if branch == 'choice' else selected
                                replacement = (f'<mc:AlternateContent xmlns:mc="{MC}" xmlns:future="urn:future-run-test">'
                                               f'<mc:Choice Requires="{requires}">{choice}</mc:Choice>'
                                               f'<mc:Fallback>{fallback}</mc:Fallback></mc:AlternateContent>')
                            text = text.replace(marker, replacement, 1)
                        parts[part] = text.encode()
                    with ZipFile(OUT / f'{position}-{branch}-{kind}.docx', 'w') as archive:
                        for name, data in parts.items():
                            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                            info.compress_type = ZIP_DEFLATED
                            archive.writestr(info, data)


if __name__ == '__main__':
    build()
