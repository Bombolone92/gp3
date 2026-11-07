"""Independent broken-reference controls derived from the original story-block control."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/story-reference-recovery'
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(ROOT / 'tests/fixtures/story-block-recovery/healthy.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    for name in ['healthy', 'missing-header', 'external-header', 'duplicate-header', 'missing-footer', 'blank-header', 'blank-footer']:
        current = dict(parts)
        if name.startswith('missing-'): del current['word/' + name.split('-')[1] + '1.xml']
        if name == 'external-header':
            current['word/_rels/document.xml.rels'] = current['word/_rels/document.xml.rels'].decode().replace('Target="header1.xml"', 'TargetMode="External" Target="https://example.invalid/header.xml"').encode()
        if name == 'duplicate-header':
            ref = '<w:headerReference w:type="default" r:id="header"/>'
            current['word/document.xml'] = current['word/document.xml'].decode().replace(ref, ref + ref).encode()
        if name.startswith('blank-'):
            kind = name.split('-')[1]
            ref = f'<w:{kind}Reference w:type="default" r:id="{kind}"/>'
            current['word/document.xml'] = current['word/document.xml'].decode().replace(ref, '').encode()
        with ZipFile(OUT / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
            for path, data in current.items(): z.writestr(path, data)
if __name__ == '__main__': main()
