"""Original font-encoded bullet controls, authored directly as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts, W, R, CT
import json

out = Path(__file__).resolve().parents[1] / 'tests/fixtures/font-encoded-bullets'
out.mkdir(exist_ok=True)
levels, paragraphs, cases = [], [], []
for face, code in [('Wingdings', 0xf09f), ('Wingdings', 0xf0a7), ('Wingdings', 0xf0fc),
                   ('Wingdings 2', 0xf0a3), ('Webdings', 0xf067), ('Symbol', 0xf0a8)]:
    for size in [10, 20]:
        i = len(cases)
        label = chr(code)
        body = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>'
        levels.append(f'<w:abstractNum w:abstractNumId="{i}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="{label}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr><w:rPr><w:rFonts w:ascii="{face}" w:hAnsi="{face}"/><w:sz w:val="{size*2}"/></w:rPr></w:lvl></w:abstractNum>')
        paragraphs.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{i+1}"/></w:numPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr>{body}</w:rPr></w:pPr><w:r><w:rPr>{body}</w:rPr><w:t>C{i:02d} first</w:t><w:br/><w:t>C{i:02d} second</w:t></w:r></w:p>')
        cases.append(dict(id=f'C{i:02d}', face=face, label=label, size=size))
parts['word/numbering.xml'] = f'<w:numbering xmlns:w="{W}">' + ''.join(levels) + ''.join(f'<w:num w:numId="{i+1}"><w:abstractNumId w:val="{i}"/></w:num>' for i in range(len(cases))) + '</w:numbering>'
parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="num" Type="{R}/numbering" Target="numbering.xml"/></Relationships>')
parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/numbering.xml" ContentType="{CT}numbering+xml"/></Types>')
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(paragraphs)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(out / 'font-encoded-bullets.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
(out / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
