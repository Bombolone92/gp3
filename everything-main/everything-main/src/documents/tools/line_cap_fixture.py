"""Original line-cap probes extending our independently authored rotation fixture."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree

root = Path(__file__).resolve().parents[1]
with ZipFile(root / 'public/fixtures/rotated-group-lines.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
xml = etree.fromstring(parts['word/document.xml'])
ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}
for i, shape in enumerate(xml.findall('.//wps:wsp', ns)):
    line = shape.find('wps:spPr/a:ln', ns)
    cap = ['flat', 'rnd', 'sq', None][i % 4]
    if cap: line.set('cap', cap)
    line.set('w', '76200')  # 6pt emphasizes cap geometry and dash gaps.
    line.find('a:prstDash', ns).set('val', ['solid', 'dot', 'sysDot', 'dashDot'][i // 4 % 4])
    if i == 2:
        # Square cap extends beyond the drawing's nominal left edge.
        shape.getparent().find('*/a:xfrm/a:off', ns).set('x', str(-50 * 12700))
for text in xml.findall('.//w:t', ns):
    if text.text == 'Rotated line probes': text.text = 'Line cap probes'
parts['word/document.xml'] = etree.tostring(xml, encoding='UTF-8', xml_declaration=True)
out = root / 'public/fixtures/drawing-line-caps.docx'
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for name, data in parts.items(): archive.writestr(name, data)
print(out)
