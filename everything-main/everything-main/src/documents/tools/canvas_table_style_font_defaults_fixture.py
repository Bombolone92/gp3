"""Manual OOXML variations isolating the table-style rPr size fallback."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as shell, W

def generate(default_size=16):
    cases = {
        'absent': '', 'empty': '<w:rPr/>',
        'color': '<w:rPr><w:color w:val="880000"/></w:rPr>',
        'bold': '<w:rPr><w:b/></w:rPr>',
        'font': '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>',
        'fill': '<w:tcPr><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr>',
        'color-fill': '<w:rPr><w:color w:val="880000"/></w:rPr><w:tcPr><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr>',
        'conditional': '<w:tblStylePr w:type="firstRow"><w:rPr><w:color w:val="880000"/></w:rPr></w:tblStylePr>',
        'conditional-empty': '<w:tblStylePr w:type="firstRow"><w:rPr/></w:tblStylePr>',
        'size': '<w:rPr><w:sz w:val="36"/></w:rPr>',
        'based-empty': '<w:basedOn w:val="size"/><w:rPr/>',
        'based-color': '<w:basedOn w:val="size"/><w:rPr><w:color w:val="880000"/></w:rPr>',
        'based-conditional': '<w:basedOn w:val="size"/><w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr></w:tblStylePr>',
    }
    parts = dict(shell)
    styles = ''.join(f'<w:style w:type="table" w:styleId="{name}"><w:name w:val="{name}"/>{content}</w:style>' for name,content in cases.items())
    parts['word/styles.xml'] = (f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr>'
        f'<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="{default_size*2}"/></w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults>' + styles + '</w:styles>')
    body = ''
    for name in cases:
        body += (f'<w:p><w:r><w:t>{name}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblStyle w:val="{name}"/>'
            '<w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0620"/>'
            '</w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr/>'
            f'<w:p><w:r><w:t>Cell_{name}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
    body += '<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="1440" w:bottom="720" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
    suffix = '' if default_size == 16 else f'-{default_size}'
    path=Path(__file__).resolve().parents[1]/f'public/fixtures/table-style-font-defaults{suffix}.docx'
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,data in parts.items():z.writestr(name,data)
    print(path)

if __name__ == '__main__':
    generate()
    generate(12)
