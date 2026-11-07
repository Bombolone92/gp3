"""Original group-lock fixture using our independent Python drawing generator.

python-docx (MIT), lxml (BSD), original XML/PNG; no user artwork is copied.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import sys
import canvas_group_fixture as groups

SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/group-locks.docx'


def generate():
    groups.SOURCE = SOURCE
    groups.generate()
    with ZipFile(SOURCE) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    for i, properties in enumerate(root.iter(groups.tag('wpg:cNvGrpSpPr'))):
        # Exercise top-level/nested groups and both lexical boolean forms.
        flags = ({'noChangeAspect': '1', 'noMove': 'true', 'noResize': '1'},
                 {'noRot': 'true', 'noGrp': '1', 'noUngrp': 'true', 'noSelect': 'false'},
                 {'noChangeAspect': 'false', 'noResize': '0', 'noSelect': '0'})[i % 3]
        groups.add(properties, 'a:grpSpLocks', **flags)
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(SOURCE, 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)


def verify(path):
    groups.SOURCE = SOURCE
    groups.verify(path)  # Includes the complete drawing trees and both MCE branches.
    with ZipFile(SOURCE) as old, ZipFile(path) as new:
        locks = lambda z: [dict(n.attrib) for n in E.fromstring(z.read('word/document.xml')).iter(groups.tag('a:grpSpLocks'))]
        assert locks(old) == locks(new) and len(locks(new)) == 6
    print('PASS retained group locks:', path)


if __name__ == '__main__':
    if len(sys.argv) == 1: generate()
    else:
        for path in sys.argv[1:]: verify(path)
