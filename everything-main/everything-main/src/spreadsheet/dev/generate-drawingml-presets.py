"""Compile Apache POI's pinned DrawingML presets into the fields used to draw them.

Usage: python3 dev/generate-drawingml-presets.py /path/to/presetShapeDefinitions.xml
Source and license are recorded in src/vendor/POI-LICENSE.txt.
"""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

source = Path(sys.argv[1]).read_bytes()
root = ET.fromstring(source)
ns = '{http://schemas.openxmlformats.org/drawingml/2006/main}'

def guides(shape, name):
    result = []
    for g in shape.findall(f'{ns}{name}/{ns}gd'):
        formula = g.attrib['fmla'].split()
        # POI's three circular-arrow presets carry an extra unused zero on
        # eight add/subtract guides. Keep the standard's three operands.
        if len(formula) == 5 and formula[0] == '+-' and formula[-1] == '0':
            formula.pop()
        result.append([g.attrib['name'], ' '.join(formula)])
    return result

presets = {}
for shape in root:
    paths = []
    for path in shape.findall(f'{ns}pathLst/{ns}path'):
        commands = []
        for command in path:
            name = command.tag.removeprefix(ns)
            if name == 'arcTo':
                commands.append(['A', *[command.attrib[k] for k in ['wR', 'hR', 'stAng', 'swAng']]])
            else:
                kind = {'moveTo': 'M', 'lnTo': 'L', 'cubicBezTo': 'C', 'quadBezTo': 'Q', 'close': 'Z'}[name]
                commands.append([kind, *[v for point in command for v in [point.attrib['x'], point.attrib['y']]]])
        paths.append({**{k: v for k, v in path.attrib.items() if k in ['w', 'h', 'fill', 'stroke']}, 'commands': commands})
    rect = shape.find(f'{ns}rect')
    presets[shape.tag] = {'adjustments': guides(shape, 'avLst'), 'guides': guides(shape, 'gdLst'),
        'rect': [rect.attrib[k] for k in ['l', 't', 'r', 'b']] if rect is not None else ['l', 't', 'r', 'b'], 'paths': paths,
        'connections': [[site.find(f'{ns}pos').attrib['x'], site.find(f'{ns}pos').attrib['y'], site.attrib['ang']]
                        for site in shape.findall(f'{ns}cxnLst/{ns}cxn')]}

header = f'// Generated from Apache POI presetShapeDefinitions.xml (Apache-2.0).\n// See POI-LICENSE.txt; regenerate with dev/generate-drawingml-presets.py.\n// Source SHA-256: {hashlib.sha256(source).hexdigest()}\n'
out = header + 'export default {\n' + ',\n'.join('  ' + json.dumps(k) + ':' + json.dumps(v, separators=(',', ':')) for k, v in presets.items()) + '\n};\n'
Path(__file__).resolve().parents[1].joinpath('src/vendor/drawingml-presets.js').write_text(out)
print(f'Compiled {len(presets)} DrawingML preset shapes ({len(out)} bytes)')
