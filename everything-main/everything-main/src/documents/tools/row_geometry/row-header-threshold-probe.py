from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET

root = Path(__file__).parent
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ET.register_namespace('w', W)
ns = {'w': W}
for mode in [14, 15]:
    with ZipFile(root / f'row-oversized-headers-{mode}-probe.docx') as source:
        parts = {name: source.read(name) for name in source.namelist()}
    document = ET.fromstring(parts['word/document.xml'])
    changed = 0
    for height in document.findall('.//w:trHeight', ns):
        if height.get(f'{{{W}}}val') == '18000':
            height.set(f'{{{W}}}val', '12600')
            changed += 1
    assert changed == 8, changed
    for cell in document.findall('.//w:tc', ns):
        for paragraph in list(cell.findall('w:p', ns)):
            text = ''.join(node.text or '' for node in paragraph.findall('.//w:t', ns))
            if ' line ' in text and not text.endswith('line 000'): cell.remove(paragraph)
    parts['word/document.xml'] = ET.tostring(document, encoding='utf-8', xml_declaration=True)
    with ZipFile(root / f'row-header-threshold-{mode}-probe.docx', 'w', ZIP_DEFLATED) as target:
        for name, data in parts.items(): target.writestr(name, data)
