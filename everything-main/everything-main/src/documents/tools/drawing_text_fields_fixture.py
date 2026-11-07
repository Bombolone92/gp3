"""Original drawing-field editing control, with no corpus assets or font programs."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
import json
import drawing_text_editing_fixture as base

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT/'tests/fixtures/drawing-text-fields'
W = base.NS['w']
RPR = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>'


def field(kind, simple=True, locked=False):
    result = '<w:r>'+RPR+'<w:t>99</w:t></w:r>'
    lock = ' w:fldLock="1"' if locked else ''
    if simple:
        return f'<w:fldSimple w:instr=" {kind} \\* MERGEFORMAT "{lock}>'+result+'</w:fldSimple>'
    return f'<w:r><w:fldChar w:fldCharType="begin"{lock}/></w:r><w:r><w:instrText xml:space="preserve"> {kind} \\* MERGEFORMAT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'+result+'<w:r><w:fldChar w:fldCharType="end"/></w:r>'


def build():
    with ZipFile(ROOT/'tests/fixtures/drawing-text-editing/control.docx') as package:
        parts = {name: package.read(name) for name in package.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    frames = root.findall('.//{'+W+'}txbxContent')
    cases = [('PAGE', True, False), ('NUMPAGES', False, False), ('SECTIONPAGES', True, True)]
    for frame, (kind, simple, locked) in zip(frames, cases):
        before = '<w:r>'+RPR+'<w:t xml:space="preserve">Before </w:t></w:r>'
        after = '<w:r>'+RPR+'<w:t xml:space="preserve"> after</w:t></w:r>'
        paragraph = E.fromstring(f'<w:p xmlns:w="{W}"><w:pPr><w:spacing w:after="0"/></w:pPr>'+before+field(kind, simple, locked)+after+'</w:p>')
        frame.replace(frame[1], paragraph)
    # Two identical adjacent envelopes expose accidental run coalescing.
    frame = frames[2]
    pair = E.fromstring(f'<w:p xmlns:w="{W}"><w:pPr><w:spacing w:after="0"/></w:pPr>'+field('PAGE', locked=True)*2+'</w:p>')
    frame.append(pair)
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    return parts


if __name__ == '__main__':
    FOLDER.mkdir(parents=True, exist_ok=True)
    with ZipFile(FOLDER/'control.docx', 'w') as package:
        for name, data in build().items():
            info = ZipInfo(name, (2026, 10, 3, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
            package.writestr(info, data)
    (FOLDER/'cases.json').write_text(json.dumps({'fields': ['PAGE', 'NUMPAGES', 'SECTIONPAGES'], 'neighborEdit': ['Before', 'Edited'], 'adjacentLockedFields': 2}, indent=2)+'\n')
    print(FOLDER/'control.docx')
