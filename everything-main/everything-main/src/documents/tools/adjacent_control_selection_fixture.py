"""Independent adjacent persistent rich-text SDTs for native selection probes."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/adjacent-control-selection'
OUT.mkdir(exist_ok=True)
with ZipFile(ROOT / 'tests/fixtures/inline-control-navigation/inline.docx') as source:
    base = {name: source.read(name) for name in source.namelist()}
text = base['word/document.xml'].decode()
start = text.index('<w:sdt>'); end = text.index('</w:sdt>', start) + len('</w:sdt>')
second = text[start:end].replace('810', '811').replace('letters', 'second').replace('>BC<', '>EF<')
base['word/document.xml'] = (text[:end] + second + text[end:]).encode()
with ZipFile(OUT / 'control.docx', 'w') as package:
    for part, data in base.items():
        entry = ZipInfo(part, (2026, 9, 30, 0, 0, 0)); entry.compress_type = ZIP_DEFLATED
        package.writestr(entry, data)
