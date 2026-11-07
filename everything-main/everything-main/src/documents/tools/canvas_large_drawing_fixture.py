"""Independent valid custom path larger than a JavaScript argument list."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import canvas_group_fixture as groups

SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/large-drawing.docx'

def generate():
    groups.SOURCE = SOURCE; groups.generate()
    with ZipFile(SOURCE) as z: parts = {n:z.read(n) for n in z.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    path = root.find('.//' + groups.tag('a:path'))
    # Several nonpainting paths keep the visible triangle intact, while each
    # path remains below the existing 10,000-command rendering limit. The
    # drawing's combined descendants still exceed JavaScript's argument limit.
    for _ in range(10):
        extra = groups.add(path.getparent(), 'a:path', w=path.get('w'), h=path.get('h'), fill='none', stroke='0')
        groups.add(groups.add(extra, 'a:moveTo'), 'a:pt', x='0', y='0')
        for _ in range(7000): groups.add(groups.add(extra, 'a:lnTo'), 'a:pt', x='0', y='0')
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(SOURCE, 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)

if __name__ == '__main__': generate()
