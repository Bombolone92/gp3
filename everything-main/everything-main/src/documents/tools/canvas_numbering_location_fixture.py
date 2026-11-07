"""Original relationship/numbering XML on the independently authored OPC shell."""
from canvas_first_section_fixture import parts as shell, W, R, CT
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
import sys

parts = dict(shell)
parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/lists/numbering2.xml" ContentType="{CT}numbering+xml"/></Types>')
parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="numbers" Type="{R}/numbering" Target="../lists/numbering2.xml"/></Relationships>')
parts['lists/numbering2.xml'] = f'<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="4"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num></w:numbering>'
body = ''.join(f'<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>' for text in ['First item', 'Second item'])
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'

if __name__ == '__main__':
    if len(sys.argv) > 1:
        with ZipFile(sys.argv[1]) as z:
            assert set(z.namelist()) == set(parts)
            rels = ET.fromstring(z.read('word/_rels/document.xml.rels'))
            assert [r.get('Target') for r in rels if r.get('Type') == R + '/numbering'] == ['../lists/numbering2.xml']
            root = ET.fromstring(z.read('word/document.xml'))
            paragraphs = root.findall(f'{{{W}}}body/{{{W}}}p')
            assert [''.join(n.text or '' for n in p.iter(f'{{{W}}}t')) for p in paragraphs] == ['Edited First item', 'Second item']
            ids = [p.find(f'{{{W}}}pPr/{{{W}}}numPr/{{{W}}}numId').get(f'{{{W}}}val') for p in paragraphs]
            assert ids[0] == '7' and ids[1] != '7'
            numbering = ET.fromstring(z.read('lists/numbering2.xml'))
            new = numbering.find(f'{{{W}}}num[@{{{W}}}numId="{ids[1]}"]')
            assert new.find(f'{{{W}}}lvlOverride/{{{W}}}startOverride').get(f'{{{W}}}val') == '1'
            assert numbering.find(f'{{{W}}}abstractNum/{{{W}}}lvl/{{{W}}}start').get(f'{{{W}}}val') == '4'
        print('PASS relocated numbering browser export:', sys.argv[1])
    else:
        out = Path(__file__).resolve().parents[1] / 'public/fixtures/numbering-location.docx'
        with ZipFile(out, 'w', ZIP_DEFLATED) as z:
            for name, text in parts.items(): z.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + text)
        print(out)
