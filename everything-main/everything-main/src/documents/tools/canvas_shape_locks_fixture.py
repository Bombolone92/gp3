"""Original independent shape-lock fixture; no corpus artwork is copied."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import canvas_group_fixture as groups

SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/shape-locks.docx'

def generate():
    groups.SOURCE = SOURCE
    groups.generate()
    with ZipFile(SOURCE) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    flags = [dict(noEditPoints='1', noAdjustHandles='true', noChangeArrowheads='1'),
             dict(noGrp='true', noRot='1', noChangeAspect='true', noMove='1', noResize='true'),
             dict(noChangeShapeType='1', noTextEdit='true', noSelect='false'),
             dict(noEditPoints='false', noSelect='0'), {}]
    for i, properties in enumerate(root.iter(groups.tag('wps:cNvSpPr'))):
        groups.add(properties, 'a:spLocks', **flags[i % len(flags)])
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(SOURCE, 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)

if __name__ == '__main__': generate()
