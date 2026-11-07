"""Original story-end versus internal-paragraph empty-control holdouts."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT/'tests/fixtures/empty-control-story-end'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def build(name):
    with ZipFile(ROOT/'tests/fixtures/empty-control-home-end/trailing.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    body = root.find(W+'body')
    if name == 'internal':
        following = E.Element(W+'p')
        E.SubElement(E.SubElement(following, W+'r'), W+'t').text = 'NEXT'
        body.insert(1, following)
    elif name == 'empty':
        p = body.find(W+'p')
        p.remove(p.find(W+'r'))
    else:
        raise ValueError('Unknown original control')
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    return parts


if __name__ == '__main__':
    FOLDER.mkdir(exist_ok=True)
    for name in ('internal', 'empty'):
        with ZipFile(FOLDER/(name+'.docx'), 'w') as z:
            for part, data in build(name).items():
                entry = ZipInfo(part, (2026, 9, 29, 0, 0, 0))
                entry.compress_type = ZIP_DEFLATED
                z.writestr(entry, data)
