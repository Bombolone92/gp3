"""Compile the pinned Apache POI PivotTable style definitions without flattening DXFs.

Usage: python3 dev/generate-pivot-style-presets.py /path/to/presetTableStyles.xml
Source revision and license: src/vendor/POI-LICENSE.txt.
"""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

source = Path(sys.argv[1]).read_bytes()
root = ET.fromstring(source)
namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
dxfs, styles = [], {}

def compact(node):
    for element in node.iter():
        if element.text is not None and not element.text.strip():
            element.text = None
        element.tail = None
    node.set('xmlns', namespace)
    return ET.tostring(node, encoding='unicode', short_empty_elements=True)

for preset in root:
    if not preset.tag.startswith('PivotStyle'):
        continue
    local = []
    for dxf in preset.find('dxfs'):
        xml = compact(dxf)
        if xml not in dxfs:
            dxfs.append(xml)
        local.append(dxfs.index(xml))
    style = preset.find('tableStyles/tableStyle')
    assert style.get('name') == preset.tag
    assert int(style.get('count')) == len(style)
    for part in style:
        if 'dxfId' in part.attrib:
            part.set('dxfId', str(local[int(part.get('dxfId'))]))
    styles[preset.tag] = compact(style)

assert len(styles) == 84
header = '// Generated from Apache POI presetTableStyles.xml (Apache-2.0).\n'
header += '// See POI-LICENSE.txt; regenerate with dev/generate-pivot-style-presets.py.\n'
header += f'// Source SHA-256: {hashlib.sha256(source).hexdigest()}\n'
out = header + 'export const pivotStyleDxfs = ' + json.dumps(dxfs, separators=(',', ':')) + ';\n'
out += 'export const pivotStyleDefinitions = {\n'
out += ',\n'.join('  ' + json.dumps(k) + ':' + json.dumps(v) for k, v in styles.items()) + '\n};\n'
Path(__file__).resolve().parents[1].joinpath('src/vendor/pivot-style-presets.js').write_text(out)
print(f'Compiled {len(styles)} PivotTable styles, {len(dxfs)} distinct DXFs ({len(out)} bytes)')
