"""Record saved native drag outcomes against independently authored OPC inputs."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/empty-control-prompt-drag'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def read(path):
    with ZipFile(path) as package:
        xml = ET.fromstring(package.read('word/document.xml'))
    paragraphs = xml.find(W + 'body').findall(W + 'p')
    text = '\n'.join(''.join(n.text or '' if n.tag == W + 't' else '\v' if n.tag == W + 'br' else ''
                             for n in p.iter()) for p in paragraphs)
    return text, len(xml.findall('.//' + W + 'sdt'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


pointer = json.loads((ROOT.parent / 'empty-control-prompt-pointer/reference.json').read_text())
cases = []
for name in ['tail-after', 'soft-after', 'break-after']:
    previous = next(c for c in pointer['cases'] if c['name'] == name)
    source = '../empty-control-prompt-pointer/' + previous['source']
    result = name + '-native.docx'
    original, controls = read(ROOT / source)
    text, remaining = read(ROOT / result)
    assert controls == 1 and remaining == 0 and original.startswith('A') and text.startswith('AQ')
    assert original.endswith(text[2:])
    end = len(original) - len(text[2:])
    assert 1 < end <= len(original)
    cases.append(dict(name=name, source=source, result=result, sourceSha256=sha(ROOT / source),
                      resultSha256=sha(ROOT / result), position=previous['position'], dx=previous['dx'],
                      originalSelectionEnd=end, marker='Q', text=text, controlCount=remaining))
(ROOT / 'reference.json').write_text(json.dumps(dict(referenceBuild='16.0.20326', cases=cases), indent=2) + '\n')
print('Verified three saved native replacements, suffix boundaries and removed control ownership')
