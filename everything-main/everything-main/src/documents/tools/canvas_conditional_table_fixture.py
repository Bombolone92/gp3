"""Independent, handwritten OOXML probes for table style region selection.

No application import/export code is used. Reference PDF output is the oracle.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as package_shell, W

REGIONS = {
    'band1Horz': '880000', 'band2Horz': '008800',
    'band1Vert': '000088', 'band2Vert': '888800',
    'firstCol': '880088', 'lastCol': '008888',
    'firstRow': 'CC4400', 'lastRow': '4400CC',
    'nwCell': 'CC0044', 'neCell': '44CC00',
    'swCell': '0044CC', 'seCell': 'CC00CC',
}
CASES = ['all', 'none', 'omitted', 'zero', 'attributes', 'cnf',
         'band1', 'band2', 'horizontal', 'bands-only', 'headers', 'first-row', 'merged', 'derived', 'whole']


def generate():
    root = Path(__file__).resolve().parents[1]
    output = root / 'public/fixtures/conditional-table-styles.docx'
    parts = dict(package_shell)
    defaults = ('<w:docDefaults><w:rPrDefault><w:rPr>'
                '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/>'
                '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>'
                '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
                '</w:pPr></w:pPrDefault></w:docDefaults>')
    region_xml = {region:
        f'<w:tblStylePr w:type="{region}"><w:rPr><w:color w:val="{color}"/>'
        f'</w:rPr><w:tcPr><w:shd w:val="clear" w:fill="{color}"/>'
        '</w:tcPr></w:tblStylePr>' for region, color in REGIONS.items()}
    regions = ''.join(region_xml.values())
    # Text is white-highlighted to keep equal text/shading colors readable.
    style = ('<w:style w:type="table" w:styleId="Regions"><w:name w:val="Regions"/>'
             '<w:rPr><w:color w:val="222222"/></w:rPr>'
             '<w:tcPr><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr>'
             + regions + '</w:style>')
    derived = ('<w:style w:type="table" w:styleId="Derived"><w:name w:val="Derived"/>'
               '<w:basedOn w:val="Regions"/><w:rPr><w:color w:val="777777"/></w:rPr>'
               '<w:tcPr><w:shd w:val="clear" w:fill="DDDDDD"/></w:tcPr>'
               '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr>'
               '</w:tblStylePr></w:style>')
    whole = ('<w:style w:type="table" w:styleId="Whole"><w:name w:val="Whole"/>'
             '<w:rPr><w:color w:val="222222"/></w:rPr>'
             '<w:tcPr><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr>'
             '<w:tblStylePr w:type="wholeTable"><w:rPr><w:color w:val="FF0000"/>'
             '</w:rPr><w:tcPr><w:shd w:val="clear" w:fill="FF0000"/>'
             '</w:tcPr></w:tblStylePr></w:style>')
    bands_style = ('<w:style w:type="table" w:styleId="Bands"><w:name w:val="Bands"/>'
                   '<w:rPr><w:color w:val="222222"/></w:rPr>'
                   '<w:tcPr><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr>'
                   + ''.join(region_xml[k] for k in REGIONS if k.startswith('band')) + '</w:style>')
    parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}">{defaults}{style}{derived}{whole}{bands_style}</w:styles>'
    body = ''
    for case in CASES:
        br = '<w:pageBreakBefore/>' if body else ''
        body += f'<w:p><w:pPr>{br}</w:pPr><w:r><w:t>{case}</w:t></w:r></w:p>'
        look = '<w:tblLook w:val="01E0"/>'
        if case == 'none': look = '<w:tblLook w:val="0600"/>'
        if case == 'omitted': look = ''
        if case == 'zero': look = '<w:tblLook w:val="0000"/>'
        if case == 'attributes':
            look = ('<w:tblLook w:val="0600" w:firstRow="1" w:lastRow="1" '
                    'w:firstColumn="1" w:lastColumn="1" w:noHBand="0" w:noVBand="0"/>')
        if case == 'first-row': look = '<w:tblLook w:val="0620"/>'
        if case == 'horizontal': look = '<w:tblLook w:val="05E0"/>'
        band_size = 2 if case == 'band2' else 1
        bands = (f'<w:tblStyleRowBandSize w:val="{band_size}"/>'
                 f'<w:tblStyleColBandSize w:val="{band_size}"/>'
                 if case in ['band1', 'band2', 'horizontal', 'bands-only'] else '')
        name = 'Derived' if case == 'derived' else 'Whole' if case == 'whole' else 'Regions'
        if case == 'bands-only': name = 'Bands'
        body += (f'<w:tbl><w:tblPr><w:tblStyle w:val="{name}"/>{bands}'
                 '<w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
                 '<w:tblCellMar><w:top w:w="80" w:type="dxa"/>'
                 '<w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/>'
                 f'<w:right w:w="80" w:type="dxa"/></w:tblCellMar>{look}</w:tblPr>'
                 '<w:tblGrid>' + '<w:gridCol w:w="1872"/>' * 5 + '</w:tblGrid>')
        for r in range(5):
            header = '<w:tblHeader/>' if case == 'headers' and r < 2 else ''
            cnf = '<w:cnfStyle w:val="111111111111"/>' if case == 'cnf' else ''
            body += f'<w:tr><w:trPr>{cnf}<w:trHeight w:val="600"/>{header}</w:trPr>'
            for c in range(5):
                if case == 'merged' and r == 0 and c == 1: continue
                span = '<w:gridSpan w:val="2"/>' if case == 'merged' and r == 0 and c == 0 else ''
                width = 3744 if span else 1872
                body += (f'<w:tc><w:tcPr>{cnf}<w:tcW w:w="{width}" w:type="dxa"/>{span}'
                         f'</w:tcPr><w:p><w:pPr>{cnf}</w:pPr><w:r><w:rPr>'
                         '<w:highlight w:val="white"/></w:rPr>'
                         f'<w:t>R{r}C{c}</w:t></w:r></w:p></w:tc>')
            body += '</w:tr>'
        body += '</w:tbl><w:p/>'
    body += ('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
             '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
             'w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
    with ZipFile(output, 'w', ZIP_DEFLATED) as z:
        for name, text in parts.items(): z.writestr(name, text)
    print(output)


if __name__ == '__main__': generate()
