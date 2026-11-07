"""Original empty DrawingML path controls; no corpus document content."""
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from canvas_bezier_fixture import generate, ROOT, A

NAME = 'empty-drawing-paths'
# Keep the existing cross-section samples away from the horizontal stroke edge.
RECT = [('M', 10, 10), ('L', 90, 10), ('L', 90, 95), ('L', 10, 95), ('Z',)]
generate([
    ('empty-filled-and-stroked', []),
    ('empty-fill-only', []),
    ('empty-stroke-only', []),
    ('empty-before-visible', RECT),
    ('empty-after-visible', RECT),
    ('nested-empty-and-visible', RECT),
], NAME)
path = ROOT / f'public/fixtures/{NAME}.docx'
with ZipFile(path) as z:
    parts = {name: z.read(name) for name in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
lists = root.findall(f'.//{{{A}}}pathLst')
lists[1][0].set('stroke', 'false')
for index in [3, 4, 5]:
    empty = E.Element(f'{{{A}}}path', w='100', h='100')
    if index == 4:
        lists[index].append(empty)
    else:
        lists[index].insert(0, empty)
parts['word/document.xml'] = E.tostring(root)
with ZipFile(path, 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
