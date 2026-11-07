"""Independent cached complex fields spanning section breaks; no corpus XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/section-fields'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def text(value):
    return f'<w:r><w:t xml:space="preserve">{value}</w:t></w:r>'

def begin(code):
    return ('<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            f'<w:r><w:instrText xml:space="preserve"> {code} </w:instrText></w:r>'
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r>')

END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'

def section(kind, columns=1):
    return (f'<w:sectPr><w:type w:val="{kind}"/>'
            '<w:pgSz w:w="12240" w:h="15840"/>'
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/>'
            f'<w:cols w:num="{columns}" w:space="720"/></w:sectPr>')

def paragraph(content, sect='', numbered=False):
    return ('<w:p><w:pPr>' + ('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' if numbered else '')
            + '<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/>'
            + sect + '</w:pPr>' + content + '</w:p>')

OUT.mkdir(exist_ok=True)
for name, kind, outer, inner in [('continuous', 'continuous', 'INDEX \\c "2"', 'TOC \\o "1-3"'),
                                  ('next-page', 'nextPage', 'TOC \\o "1-3"', 'INDEX \\c "2"')]:
    body = paragraph(text('C01 Before field'))
    body += paragraph(begin(outer) + text('C02 Result before section'))
    body += paragraph(begin(inner), section('nextPage'))
    for i in range(3, 19):
        body += paragraph(text(f'C{i:02} Cached entry {i-2:02}'))
    body += paragraph('', section(kind, 2))
    body += paragraph(text('C19 Result after section') + END)
    body += paragraph(text('C20 Outer result end') + END)
    body += paragraph(text('C21 After field')) + section(kind)
    # Package construction is shared with the marker-only boundary controls.
    if name == 'continuous':
        boundary_body = ''
        for i, mode in enumerate(['empty', 'begin', 'end', 'whole', 'xe']):
            before, after = text(f'C{i*2+1:02} {mode} before'), text(f'C{i*2+2:02} {mode} after')
            boundary = ''
            if mode == 'begin':
                boundary, after = begin('TOC'), after + END
            if mode == 'end':
                before, boundary = begin('TOC') + before, END
            if mode == 'whole':
                boundary = begin('TOC') + END
            if mode == 'xe':
                boundary = begin('XE &quot;entry&quot;').replace('<w:r><w:fldChar w:fldCharType="separate"/></w:r>', '') + END
            boundary_body += paragraph(before) + paragraph(boundary, section('continuous')) + paragraph(after)
        boundary_body += paragraph(text('C11 Numbered field before'))
        boundary_body += paragraph(begin('TOC'), section('continuous'), numbered=True)
        boundary_body += paragraph(text('C12 Numbered field after') + END)
        boundary_body += paragraph(text('C13 Following list item'), numbered=True) + section('continuous')
    with ZipFile(ROOT / 'public/fixtures/empty-table-fragment.docx') as source:
        parts = {n: source.read(n) for n in source.namelist()}
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
    # Explicit defaults avoid dependence on the installed application theme.
    parts['word/styles.xml'] = (f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr>'
        '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/>'
        '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>')
    rel = parts['word/_rels/document.xml.rels'].decode()
    if 'relationships/styles' not in rel:
        rel = rel.replace('</Relationships>', '<Relationship Id="sectionStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    parts['word/_rels/document.xml.rels'] = rel
    types = parts['[Content_Types].xml'].decode()
    if '/word/styles.xml' not in types:
        types = types.replace('</Types>', '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
    parts['[Content_Types].xml'] = types
    with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as target:
        for n, data in parts.items():
            target.writestr(n, data)

# Reuse only the independently authored shell/defaults; install a simple list.
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{boundary_body}</w:body></w:document>'
parts['word/numbering.xml'] = (f'<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>'
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>'
    '<w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="360"/></w:pPr>'
    '</w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')
parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', '<Relationship Id="sectionNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>')
parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>')
with ZipFile(OUT / 'boundaries.docx', 'w', ZIP_DEFLATED) as target:
    for n, data in parts.items():
        target.writestr(n, data)
