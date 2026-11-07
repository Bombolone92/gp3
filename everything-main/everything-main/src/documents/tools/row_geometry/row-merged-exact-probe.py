from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).parent
for position in ['oversized', 'later']:
    for mode in [14, 15]:
        with ZipFile(root / f'row-merged-{position}-{mode}-probe.docx') as source:
            parts = {name: source.read(name) for name in source.namelist()}
        xml = parts['word/document.xml'].decode()
        declaration = '<w:trHeight w:val="18000" w:hRule="atLeast"/>'
        assert xml.count(declaration) == 1
        parts['word/document.xml'] = xml.replace(declaration, declaration.replace('atLeast', 'exact')).encode()
        with ZipFile(root / f'row-merged-exact-{position}-{mode}-probe.docx', 'w', ZIP_DEFLATED) as target:
            for name, data in parts.items(): target.writestr(name, data)
