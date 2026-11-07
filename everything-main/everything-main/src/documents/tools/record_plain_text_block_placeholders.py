"""Bind original placeholder probes to installed reference evidence."""
from pathlib import Path
from hashlib import sha256
import json
from zipfile import ZipFile
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/plain-text-block-placeholders'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
results = json.loads((ROOT / 'native-edits.json').read_text(encoding='utf-8-sig'))
cases = json.loads((ROOT / 'cases.json').read_text())
records = []
for case in cases:
    name = case['name']
    record = dict(case, observations=[r for r in results if r['case'] == name])
    record['sourceSha256'] = sha256((ROOT / (name + '-source.docx')).read_bytes()).hexdigest()
    record['nativeFiles'] = {}
    for path in sorted(ROOT.glob(name + '-*-native.docx')):
        with ZipFile(path) as package:
            xml = E.fromstring(package.read('word/document.xml'))
        record['nativeFiles'][path.name] = {
            'sha256': sha256(path.read_bytes()).hexdigest(),
            'controlCount': len(xml.xpath('//w:sdt', namespaces=NS)),
            'controls': [dict(
                paragraphs=len(s.xpath('./w:sdtContent/w:p', namespaces=NS)),
                text=s.xpath('.//w:t/text()', namespaces=NS),
                boldRuns=len(s.xpath('.//w:r/w:rPr/w:b', namespaces=NS)),
            ) for s in xml.xpath('//w:sdt', namespaces=NS)],
        }
    pdf = ROOT / (name + '-native.pdf')
    if pdf.exists():
        record['pdfSha256'] = sha256(pdf.read_bytes()).hexdigest()
    records.append(record)
(ROOT / 'reference.json').write_text(json.dumps({'referenceVersion': '16.0.20326', 'cases': records}, indent=2) + '\n')
print(f'Recorded {len(records)} independent control cases')
