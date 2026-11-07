"""Original OOXML control for the Home tab's editing commands: Change Case, Format Painter, Sort and
formatting marks. Mixed runs, a character style, a heading, an unsorted run of paragraphs, tabs, a
nonbreaking space, a line break, a table and a page break. Authored directly as OPC/XML with stdlib only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as shell, W

parts = dict(shell)
parts['word/styles.xml'] = (f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>'
  '<w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>'
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>'
  '<w:style w:type="character" w:styleId="Accent"><w:name w:val="Accent"/><w:rPr><w:i/><w:color w:val="C00000"/></w:rPr></w:style></w:styles>')

def run(text, props=''):
    space = ' xml:space="preserve"' if text != text.strip() else ''
    return f'<w:r>{f"<w:rPr>{props}</w:rPr>" if props else ""}<w:t{space}>{text}</w:t></w:r>'
def para(content, props=''):
    return f'<w:p>{f"<w:pPr>{props}</w:pPr>" if props else ""}{content}</w:p>'

body = para(run('editing commands control'), '<w:pStyle w:val="Heading1"/>')
body += para(run('Source ') + run('accent', '<w:rStyle w:val="Accent"/><w:b/>') + run(' and plain target words.'))
body += para(run('mixed case SENTENCE. second sentence here'))
for fruit in ['cherry', 'Apple', 'banana', 'date']:
    body += para(run(fruit))
body += para(run('Tab') + '<w:r><w:tab/></w:r>' + run('stop nbsp') + '<w:r><w:br/></w:r>' + run('after break'))
cell = lambda text: f'<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>{para(run(text))}</w:tc>'
body += ('<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>'
  '<w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>'
  f'<w:tr>{cell("cell one")}{cell("cell two")}</w:tr></w:tbl>')
body += para(run('before page') + '<w:r><w:br w:type="page"/></w:r>' + run('next page'))
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'

if __name__ == '__main__':
    out = Path(__file__).resolve().parents[1] / 'public/fixtures/home-editing.docx'
    with ZipFile(out, 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)
    print(out)
