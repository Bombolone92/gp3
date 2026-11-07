from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import runpy

root = Path(__file__).parent
runpy.run_path(str(root / 'row-merged-oversized-probe.py'))
for mode in [14, 15]:
    with ZipFile(root / f'row-merged-oversized-{mode}-probe.docx') as source:
        parts = {name: source.read(name) for name in source.namelist()}
    xml = parts['word/document.xml'].decode()
    height = '<w:trPr><w:trHeight w:val="18000" w:hRule="atLeast"/></w:trPr>'
    xml = xml.replace(height, '', 1)
    continuation = '<w:tr><w:tc><w:tcPr><w:tcW w:w="2160" w:type="dxa"/><w:vMerge/>'
    assert xml.count(continuation) == 1
    xml = xml.replace(continuation, continuation.replace('<w:tr>', '<w:tr>' + height))
    parts['word/document.xml'] = xml.encode()
    with ZipFile(root / f'row-merged-later-{mode}-probe.docx', 'w', ZIP_DEFLATED) as target:
        for name, data in parts.items(): target.writestr(name, data)
