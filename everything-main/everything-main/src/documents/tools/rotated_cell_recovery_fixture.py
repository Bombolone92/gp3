"""Original paired OOXML controls; no renderer serialization or application repair."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/rotated-cell-recovery'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ET.register_namespace('w', W)
ET.register_namespace('r', R)
def tag(name): return '{' + W + '}' + name
def xml(node): return ET.tostring(node, encoding='utf-8', xml_declaration=True)

def main():
    OUT.mkdir(exist_ok=True)
    with ZipFile(ROOT / 'tests/fixtures/cell-text-direction/control.docx') as z:
        original = {n: z.read(n) for n in z.namelist()}
    for name in ['before', 'after', 'both', 'nested', 'stories']:
        for control in [False, True]:
            parts = dict(original)
            doc = ET.fromstring(parts['word/document.xml'])
            body = doc.find(tag('body'))
            # Three independently authored source tables, one per page.
            for child in list(body)[9:-1]: body.remove(child)
            cells = body.findall('.//' + tag('tc'))
            affected = [1] if name in ['before', 'nested'] else [7] if name == 'after' else [1, 7]
            if name == 'stories': affected = []
            for index in affected:
                cell = cells[index]
                pr = cell.find(tag('tcPr'))
                if name == 'nested':
                    nested = ET.fromstring(f'<w:tbl xmlns:w="{W}"><w:tblPr><w:tblW w:w="1200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Nested text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
                    cell.insert(1, nested)
                else: ET.SubElement(pr, tag('hideMark'))
                if control: pr.find(tag('textDirection')).set(tag('val'), 'lrTb')
            if name == 'stories':
                for kind in ['header', 'footer']:
                    table = deepcopy(body.find(tag('tbl')))
                    table.find('.//' + tag('trHeight')).set(tag('val'), '720')
                    target = table.findall('.//' + tag('tc'))[1]
                    ET.SubElement(target.find(tag('tcPr')), tag('hideMark'))
                    if control: target.find('.//' + tag('textDirection')).set(tag('val'), 'lrTb')
                    story = ET.Element(tag('hdr' if kind == 'header' else 'ftr'))
                    story.append(table)
                    p = ET.SubElement(story, tag('p'))
                    ET.SubElement(ET.SubElement(p, tag('r')), tag('t')).text = 'Retained ' + kind
                    part = f'word/{kind}1.xml'
                    parts[part] = xml(story)
                    relid = 'recovery' + kind
                    reference = ET.Element(tag(kind + 'Reference'), {tag('type'): 'default', '{' + R + '}id': relid})
                    body.find(tag('sectPr')).insert(0, reference)
                    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace(b'</Relationships>', f'<Relationship Id="{relid}" Type="{R}/{kind}" Target="{kind}1.xml"/></Relationships>'.encode())
                    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(b'</Types>', f'<Override PartName="/{part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/></Types>'.encode())
            parts['word/document.xml'] = xml(doc)
            with ZipFile(OUT / (name + ('-control' if control else '') + '.docx'), 'w', ZIP_DEFLATED) as z:
                for part, data in parts.items(): z.writestr(part, data)

if __name__ == '__main__': main()
