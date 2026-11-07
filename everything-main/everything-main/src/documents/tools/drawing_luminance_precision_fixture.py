"""Original DrawingML luminance swatches, authored as OPC/XML; no corpus XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from lxml import etree as E
from canvas_group_fixture import NS, tag, add, shape

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'tests/fixtures/drawing-luminance-precision'


def generate(target=TARGET, sequence_probes=False):
    with ZipFile(ROOT / 'public/fixtures/dense-guides.docx') as package:
        parts = {name: package.read(name) for name in package.namelist()}
    # Reuse the independently authored theme, with explicit white lt1/bg1.
    with ZipFile(ROOT / 'public/fixtures/shape-theme.docx') as package:
        parts['word/theme/probe.xml'] = package.read('word/theme/probe.xml')
    rels = E.fromstring(parts['word/_rels/document.xml.rels'])
    E.SubElement(rels, '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',
                 Id='luminanceTheme', Type=NS['r'] + '/theme', Target='theme/probe.xml')
    parts['word/_rels/document.xml.rels'] = E.tostring(rels)
    types = E.fromstring(parts['[Content_Types].xml'])
    E.SubElement(types, '{http://schemas.openxmlformats.org/package/2006/content-types}Override',
                 PartName='/word/theme/probe.xml', ContentType='application/vnd.openxmlformats-officedocument.theme+xml')
    parts['[Content_Types].xml'] = E.tostring(types)
    root = E.fromstring(parts['word/document.xml'])
    body = root.find(tag('w:body'))
    template = deepcopy(root.find('.//' + tag('wp:anchor')))
    section = deepcopy(body.find(tag('w:sectPr')))
    body.clear()
    bases = [('srgbClr', color) for color in ['FFFFFF', '000000', '808080', '112233', '2468AC', 'C0504D', '00FF00']]
    bases.append(('schemeClr', 'bg1'))
    transforms = [[], [('lumMod', 0)], [('lumMod', 25000)], [('lumMod', 50000)],
                  [('lumMod', 75000)], [('lumMod', 100000)], [('lumOff', 25000)],
                  [('lumOff', 50000)], [('lumOff', -25000)],
                  [('lumMod', 50000), ('lumOff', 25000)],
                  [('lumOff', 25000), ('lumMod', 50000)], [('satMod', 50000)]]
    if sequence_probes:
        bases = [('srgbClr', color) for color in ['010203', 'FEFDFC', '13579B', 'AA3355', '19C083', '80817F', '0000FF', 'FF0000']]
        transforms = [[], [('lumMod', 37000)], [('lumOff', 13000)], [('lumOff', -17000)],
                      [('satMod', 63000)], [('satMod', 0)],
                      [('lumMod', 37000), ('lumOff', 13000)],
                      [('lumOff', 13000), ('lumMod', 37000)],
                      [('lumMod', 13000), ('lumOff', 7000), ('lumMod', 73000)],
                      [('satMod', 63000), ('lumMod', 37000)],
                      [('shade', 37000), ('tint', 63000)],
                      [('tint', 63000), ('shade', 37000)]]
    cases = []
    for kind, base in bases:
        for modifiers in transforms:
            index = len(cases)
            page, cell = divmod(index, 32)
            if cell == 0:
                p = add(body, 'w:p')
                props = add(p, 'w:pPr')
                if page:
                    add(props, 'w:pageBreakBefore')
                add(props, 'w:spacing', **{'w:before': 0, 'w:after': 0, 'w:line': 360, 'w:lineRule': 'exact'})
                add(add(p, 'w:r'), 'w:t', text=f'DrawingML luminance controls {page + 1}')
            x, y = 36 + 68 * (cell % 8), 90 + 150 * (cell // 8)
            p = add(body, 'w:p')
            add(add(p, 'w:pPr'), 'w:spacing', **{'w:before': 0, 'w:after': 0, 'w:line': 20, 'w:lineRule': 'exact'})
            anchor = deepcopy(template)
            add(add(p, 'w:r'), 'w:drawing').append(anchor)
            for axis, value in [('H', x), ('V', y)]:
                position = anchor.find(tag('wp:position' + axis))
                position.set('relativeFrom', 'page')
                position.find(tag('wp:posOffset')).text = str(value * 12700)
            extent = anchor.find(tag('wp:extent'))
            extent.set('cx', str(45 * 12700)); extent.set('cy', str(70 * 12700))
            properties = anchor.find(tag('wp:docPr'))
            properties.set('id', str(index + 1)); properties.set('name', f'Luminance {index + 1}')
            data = anchor.find('.//' + tag('a:graphicData'))
            data.clear(); data.set('uri', NS['wps'])
            drawing = shape(data, index + 1, 45 * 12700, 70 * 12700, 0, 0, '000000')
            fill = drawing.find('.//' + tag('a:solidFill')); fill.clear()
            color = add(fill, 'a:' + kind, val=base)
            for name, value in modifiers:
                add(color, 'a:' + name, val=value)
            cases.append({'id': index + 1, 'page': page, 'x': x + 20, 'y': y + 35,
                          'kind': kind, 'base': base, 'transforms': modifiers})
    body.append(section)
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    target.mkdir(parents=True, exist_ok=True)
    with ZipFile(target / 'source.docx', 'w', ZIP_DEFLATED) as package:
        for name, data in parts.items():
            package.writestr(name, data)
    (target / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--sequence-probes', action='store_true')
    args = parser.parse_args()
    if args.sequence_probes and not args.output_dir:
        parser.error('--sequence-probes requires --output-dir to preserve existing native references')
    generate(args.output_dir or TARGET, args.sequence_probes)
