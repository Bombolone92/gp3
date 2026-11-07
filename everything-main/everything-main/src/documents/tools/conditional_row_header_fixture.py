"""Original conditional table-row header controls, written directly as OOXML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
CASES = ['first-row', 'first-column', 'horizontal-band', 'derived-off',
         'repeat-style', 'repeat-direct', 'repeat-off', 'repeat-look-off',
         'nonleading-direct', 'repeat-band']

def generate():
    with ZipFile(ROOT / 'public/fixtures/table-no-wrap.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    defaults = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    styles, body = defaults, ''
    for i, case in enumerate(CASES):
        region = 'firstCol' if case == 'first-column' else 'band1Horz' if case in ['horizontal-band', 'repeat-band'] else 'firstRow'
        header = '' if case in ['repeat-direct', 'nonleading-direct'] else '<w:tblHeader/>'
        color = '<w:rPr><w:color w:val="CC4400"/></w:rPr>'
        styles += f'<w:style w:type="table" w:styleId="C{i}"><w:name w:val="Control {i}"/><w:tblPr><w:tblStyleRowBandSize w:val="1"/></w:tblPr><w:tblStylePr w:type="{region}">'
        if region == 'firstRow': styles += color
        styles += f'<w:trPr>{header}</w:trPr></w:tblStylePr>'
        if region != 'firstRow': styles += f'<w:tblStylePr w:type="firstRow">{color}</w:tblStylePr>'
        styles += '</w:style>'
        style = f'C{i}'
        if case == 'derived-off':
            styles += f'<w:style w:type="table" w:styleId="Derived"><w:name w:val="Derived"/><w:basedOn w:val="C{i}"/><w:tblStylePr w:type="firstRow"><w:trPr><w:tblHeader w:val="0"/></w:trPr></w:tblStylePr></w:style>'
            style = 'Derived'
        body += '<w:p><w:pPr>' + ('<w:pageBreakBefore/>' if i else '') + f'</w:pPr><w:r><w:t>Conditional row controls: {case}</w:t></w:r></w:p>'
        look = '0480' if case == 'repeat-look-off' else '04A0'
        body += f'<w:tbl><w:tblPr><w:tblStyle w:val="{style}"/><w:tblW w:type="dxa" w:w="7200"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'
        body += ''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top', 'left', 'bottom', 'right'])
        body += f'</w:tblCellMar><w:tblLook w:val="{look}"/></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="3600"/></w:tblGrid>'
        for r in range(8 if case.startswith('repeat') else 4):
            height = 2000 if case.startswith('repeat') else 600
            direct = '<w:tblHeader/>' if case == 'repeat-direct' and r == 0 else '<w:tblHeader w:val="0"/>' if case == 'repeat-off' and r == 0 else ''
            if case == 'nonleading-direct' and r in [1, 3]: direct = '<w:tblHeader/>'
            body += f'<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="{height}" w:hRule="exact"/>{direct}</w:trPr>'
            for c in range(2):
                body += f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="3600"/><w:shd w:val="clear" w:fill="DEECEC"/></w:tcPr><w:p><w:r><w:t>C{i}R{r}C{c}</w:t></w:r></w:p></w:tc>'
            body += '</w:tr>'
        body += '</w:tbl><w:p/>'
    body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
    parts['word/styles.xml'] = (styles + '</w:styles>').encode()
    with ZipFile(ROOT / 'public/fixtures/conditional-row-header.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)

if __name__ == '__main__': generate()
