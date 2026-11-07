"""Original simultaneous caps/smallCaps controls, authored as OOXML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
folder = ROOT / 'tests/fixtures/combined-caps'
folder.mkdir(parents=True, exist_ok=True)
with ZipFile(ROOT / 'public/fixtures/conditional-row-header.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
styles = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="40"/></w:rPr></w:rPrDefault></w:docDefaults>'
body, cases = '', []
for context in ['direct', 'paragraph', 'character', 'table']:
    for inherited in ['normal', 'caps', 'smallCaps']:
        for caps, small in [(False, False), (True, False), (False, True), (True, True)]:
            i = len(cases)
            case = dict(id=f'K{i:02}', context=context, inherited=inherited, caps=caps, smallCaps=small)
            cases.append(case)
            flags = f'<w:caps w:val="{int(caps)}"/><w:smallCaps w:val="{int(small)}"/>'
            base = '' if inherited == 'normal' else f'<w:{inherited}/>'
            kind = 'table' if context == 'table' else 'paragraph'
            styles += f'<w:style w:type="{kind}" w:styleId="B{i}"><w:name w:val="Base {i}"/><w:rPr>{base}</w:rPr></w:style>'
            pstyle, rstyle, direct = f'B{i}', '', ''
            if context == 'direct': direct = flags
            elif context == 'character':
                styles += f'<w:style w:type="character" w:styleId="C{i}"><w:name w:val="Character {i}"/><w:rPr>{flags}</w:rPr></w:style>'
                rstyle = f'<w:rStyle w:val="C{i}"/>'
            else:
                override = f'<w:tblStylePr w:type="firstRow"><w:rPr>{flags}</w:rPr></w:tblStylePr>' if context == 'table' else f'<w:rPr>{flags}</w:rPr>'
                styles += f'<w:style w:type="{kind}" w:styleId="C{i}"><w:name w:val="Derived {i}"/><w:basedOn w:val="B{i}"/>{override}</w:style>'
                pstyle = f'C{i}'
            if i % 12 == 0 and i: body += '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>'
            ppr = (f'<w:pStyle w:val="{pstyle}"/>' if context != 'table' else '') + '<w:spacing w:before="0" w:after="0" w:line="720" w:lineRule="exact"/>'
            label = f'<w:r><w:rPr><w:caps w:val="0"/><w:smallCaps w:val="0"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">K{i:02} </w:t></w:r>'
            p = f'<w:p><w:pPr>{ppr}</w:pPr>{label}<w:r><w:rPr>{rstyle}{direct}</w:rPr><w:t>Abc XYZ</w:t></w:r></w:p>'
            if context == 'table':
                p = f'<w:tbl><w:tblPr><w:tblStyle w:val="{pstyle}"/><w:tblW w:type="dxa" w:w="9000"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0620"/></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="9000"/></w:tcPr>{p}</w:tc></w:tr></w:tbl>'
            body += p
styles += '</w:styles>'
body += '<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
parts['word/styles.xml'] = styles.encode()
with ZipFile(ROOT / 'public/fixtures/combined-caps.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items(): z.writestr(n, data)
(folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
