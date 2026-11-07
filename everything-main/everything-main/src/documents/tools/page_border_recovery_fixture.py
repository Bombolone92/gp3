"""Original mixed-content controls for independent page-border recovery."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/page-border-recovery'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}

def main():
    OUT.mkdir(exist_ok=True)
    with ZipFile(ROOT / 'tests/fixtures/page-setting-recovery/healthy.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    # The source is our independently authored two-section control, with styles,
    # a list, table and two PNGs. Only new border declarations differ here.
    for name, failed in [('healthy', []), ('top', ['top']), ('left', ['left']),
                         ('bottom', ['bottom']), ('right', ['right']),
                         ('combined', ['top', 'right'])]:
        for omitted in [False, True] if failed else [False]:
            doc = etree.fromstring(parts['word/document.xml'])
            for section in doc.xpath('//w:sectPr', namespaces=NS):
                borders = etree.Element(f'{{{W}}}pgBorders', {f'{{{W}}}offsetFrom':'page', f'{{{W}}}zOrder':'back'})
                margins = section.find('w:pgMar', NS)
                section.insert(list(section).index(margins)+1, borders)
                for side, color in [('top','CC2233'),('left','2244CC'),('bottom','228844'),('right','8822AA')]:
                    if omitted and side in failed: continue
                    attrs = {'val':'wave' if side in failed else 'single', 'sz':'48', 'space':'24', 'color':color}
                    etree.SubElement(borders, f'{{{W}}}{side}', {f'{{{W}}}{k}':v for k,v in attrs.items()})
            current = {**parts, 'word/document.xml':etree.tostring(doc)}
            path = OUT / (name + ('-omitted' if omitted else '') + '.docx')
            with ZipFile(path, 'w') as z:
                for n, data in current.items():
                    info = ZipInfo(n, date_time=(2026,9,29,0,0,0)); info.compress_type=ZIP_DEFLATED
                    z.writestr(info,data)

if __name__ == '__main__': main()
