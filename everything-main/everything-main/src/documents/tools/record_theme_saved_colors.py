"""Verify saved color fallbacks against an independently extracted PDF reference."""
import argparse
import hashlib
import json
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
parser.add_argument('saved_docx', type=Path)
parser.add_argument('--reference-build', required=True)
args = parser.parse_args()
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
cases = json.loads((args.directory / 'cases.json').read_text())
reference = json.loads((args.directory / 'reference.json').read_text())
labels = {c['label'] for c in cases}
rows = []
with ZipFile(args.saved_docx) as package:
    document = ET.fromstring(package.read('word/document.xml'))
for paragraph in document.findall('.//w:p', ns):
    label = ''.join(t.text or '' for t in paragraph.findall('.//w:t', ns))
    if label not in labels:
        continue
    colors = paragraph.findall('.//w:color', ns)
    if len(colors) != 1:
        raise ValueError('Expected one native color for ' + label)
    rows.append(dict(label=label, attributes={k.split('}')[-1]: v for k, v in colors[0].attrib.items()}))
if [r['label'] for r in rows] != [c['label'] for c in cases]:
    raise ValueError('Saved labels differ from the complete case inventory')
for saved, native in zip(rows, reference['colors'], strict=True):
    if saved['label'] != native['label'] or list(bytes.fromhex(saved['attributes']['val'])) != native['rgb']:
        raise ValueError('Saved XML and PDF disagree for ' + saved['label'])
result = dict(referenceBuild=args.reference_build, savedDocxSha256=hashlib.sha256(args.saved_docx.read_bytes()).hexdigest(), colors=rows)
(args.directory / 'native-saved-colors.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'All {len(rows)} saved RGB values match the native PDF')
