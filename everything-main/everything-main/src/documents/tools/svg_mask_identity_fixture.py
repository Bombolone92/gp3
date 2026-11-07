"""Identity-filter companions for original curved opacity mask controls."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from copy import deepcopy
import sys
import canvas_svg_fixture as fixture

root=Path(__file__).resolve().parents[1]
name=sys.argv[1] if len(sys.argv)>1 else 'svg-mask-opacity'
assert name in ['svg-mask-opacity','svg-mask-opacity-expanded']
with ZipFile(root/'public/fixtures'/(name+'.docx')) as package:
    svg=ET.fromstring(package.read('word/media/vector.svg'))
ns='{http://www.w3.org/2000/svg}'
ET.register_namespace('',ns[1:-1])
masks=list(svg.iter(ns+'mask'))
assert len(masks)==6
for child in list(svg):svg.remove(child)
defs=ET.SubElement(svg,ns+'defs')
effect=ET.SubElement(defs,ns+'filter',{'id':'identity','color-interpolation-filters':'sRGB'})
ET.SubElement(effect,ns+'feColorMatrix',{'type':'matrix','values':'1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0'})
for mask in masks:
    group=ET.SubElement(svg,ns+'g',{'filter':'url(#identity)'})
    for child in mask:group.append(deepcopy(child))
fixture.SOURCE=root/'public/fixtures'/(name+'-intermediate.docx')
fixture.SVG=ET.tostring(svg,encoding='utf-8')
fixture.generate()
folder=root/'tests/fixtures'/(name+'-intermediate')
folder.mkdir(exist_ok=True)
(folder/'cases.json').write_bytes((root/'tests/fixtures'/name/'cases.json').read_bytes())
