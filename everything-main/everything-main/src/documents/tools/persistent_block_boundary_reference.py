"""Record native boundary structure and bind it to source/result DOCX hashes."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/persistent-block-controls'
OUT = ROOT / 'boundary-matrix'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
cases = json.loads((OUT / 'native-results.json').read_text(encoding='utf-8-sig'))
for case in cases:
    name = case['name']
    data = (OUT / (name + '.docx')).read_bytes()
    with ZipFile(OUT / (name + '.docx')) as package:
        root = etree.fromstring(package.read('word/document.xml'))
    title = next(t for t in ('two-paragraphs', 'placeholder', 'replace') if name.startswith(t + '-'))
    control, = root.xpath('//w:sdt[w:sdtPr/w:alias/@w:val=$title]', namespaces=NS, title=title)
    case.update(title=title, operation=name[len(title) + 1:],
                kind='inline' if etree.QName(control.getparent()).localname == 'p' else 'block',
                bodyParagraphs=[''.join(p.xpath('.//w:t/text()', namespaces=NS))
                                for p in root.xpath('/w:document/w:body//w:p', namespaces=NS)],
                sha256=hashlib.sha256(data).hexdigest())
reference = {'referenceVersion': '16.0.20326', 'source': '../control.docx',
             'sourceSha256': hashlib.sha256((ROOT / 'control.docx').read_bytes()).hexdigest(),
             'cases': cases}
reference['restoredPlaceholderSha256'] = hashlib.sha256((OUT / 'converted-placeholder-restored.docx').read_bytes()).hexdigest()
(OUT / 'reference.json').write_text(json.dumps(reference, indent=2) + '\n', encoding='utf-8')
