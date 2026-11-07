"""Compact, original OOXML controls for live native-reference outline-width measurements."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/outline-display-width'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'

with ZipFile(ROOT / 'tests/fixtures/thin-shape-outlines/control.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
doc = E.fromstring(parts['word/document.xml'])
body = doc.find(f'{{{W}}}body')
drawing = deepcopy(body.find(f'.//{{{W}}}drawing'))
body.clear()
p = E.SubElement(body, f'{{{W}}}p')
cases = []
for i, width in enumerate([0, 1588, 3175, 4327, 6350, 9525, 12700, 19050]):
    for j, shape in enumerate(['rect', 'ellipse']):
        node = deepcopy(drawing)
        x, y = 18 + (i % 2) * 90 + j * 40, 18 + (i // 2) * 20
        for axis, value in [('H', x), ('V', y)]:
            node.find(f'.//{{{WP}}}position{axis}/{{{WP}}}posOffset').text = str(value * 12700)
        for extent in [node.find(f'.//{{{WP}}}extent'), node.find(f'.//{{{A}}}xfrm/{{{A}}}ext')]:
            extent.set('cx', str(30 * 12700)); extent.set('cy', str(10 * 12700))
        ident = i * 2 + j + 1
        node.find(f'.//{{{WP}}}docPr').set('id', str(ident))
        node.find(f'.//{{{WP}}}docPr').set('name', f'{shape}-{width}')
        node.find(f'.//{{{A}}}prstGeom').set('prst', shape)
        node.find(f'.//{{{A}}}ln').set('w', str(width))
        E.SubElement(p, f'{{{W}}}r').append(node)
        cases.append(dict(id=ident, shape=shape, widthEmu=width, boundsPt=[x,y,30,10]))
section = E.SubElement(body, f'{{{W}}}sectPr')
E.SubElement(section, f'{{{W}}}pgSz', {f'{{{W}}}w':'4000', f'{{{W}}}h':'2160'})
E.SubElement(section, f'{{{W}}}pgMar', {f'{{{W}}}{k}':v for k,v in
    dict(top='120',right='120',bottom='120',left='120',header='0',footer='0',gutter='0').items()})
parts['word/document.xml'] = E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
OUT.mkdir(exist_ok=True)
for name, modern in [('legacy',False),('modern',True)]:
    result = dict(parts)
    if modern:
        settings = E.Element(f'{{{W}}}settings', nsmap={'w':W})
        compat = E.SubElement(settings, f'{{{W}}}compat')
        E.SubElement(compat, f'{{{W}}}compatSetting', {f'{{{W}}}name':'compatibilityMode',
            f'{{{W}}}uri':'http://schemas.microsoft.com/office/word', f'{{{W}}}val':'15'})
        result['word/settings.xml'] = E.tostring(settings, xml_declaration=True, encoding='UTF-8')
        rels = E.fromstring(result['word/_rels/document.xml.rels'])
        E.SubElement(rels, f'{{{R}}}Relationship', Id='rIdSettings',
            Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', Target='settings.xml')
        result['word/_rels/document.xml.rels'] = E.tostring(rels, xml_declaration=True, encoding='UTF-8')
        types = E.fromstring(result['[Content_Types].xml'])
        E.SubElement(types, f'{{{CT}}}Override', PartName='/word/settings.xml',
            ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml')
        result['[Content_Types].xml'] = E.tostring(types, xml_declaration=True, encoding='UTF-8')
    with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as archive:
        for part, data in result.items(): archive.writestr(part, data)
(OUT / 'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf-8')
