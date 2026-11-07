"""Author independent fixed-table reduction controls directly in OOXML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/fixed-table-reduction'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
CASES = [dict(name=f'margin-{m}', margin=m, grid=[800,2800,1000,5800], width=10000,
              rows=[[(850,1),(2950,1),(1050,1),(6150,1)]])
         for m in [0,50,100,108,200,400]]
CASES += [
    dict(name='conflicting-rows', margin=0, grid=[2000,2000], width=4000,
         rows=[[(3000,1),(3000,1)],[(4000,1),(2000,1)]]),
    dict(name='merged-first', margin=0, grid=[800,2800,1000,5800], width=10000,
         rows=[[(3800,2),(1050,1),(6150,1)],[(850,1),(2950,1),(1050,1),(6150,1)]]),
    dict(name='merged-last', margin=0, grid=[800,2800,1000,5800], width=10000,
         rows=[[(850,1),(2950,1),(1050,1),(6150,1)],[(3800,2),(1050,1),(6150,1)]]),
]
MARGIN_CASES = [dict(name=f'minimum-{margin}-{width}', margin=margin,
                    grid=[1000,1000], width=width, rows=[[(1000,1),(1000,1)]])
                for margin, values in [(0,[20,40,60]),(100,[400,440,600]),(400,[1600,1640,1800])]
                for width in values]
MARGIN_CASES += [
    dict(name='merged-margins', margin=108, grid=[800,2800,1000,5800], width=10000,
         rows=[[(3800,2),(1050,1),(6150,1)],[(850,1),(2950,1),(1050,1),(6150,1)]]),
    dict(name='merged-only-margins', margin=200, grid=[800,2800,1000,5800], width=10000,
         rows=[[(3800,2),(1050,1),(6150,1)]]),
    dict(name='opposing-row-margins', margin=0, grid=[1000,3000], width=3000,
         rows=[[(1000,1),(3000,1)],[(1000,1),(3000,1)]],
         cellMargins=[[(400,0),(0,0)],[(0,400),(0,0)]]),
    dict(name='unequal-cell-margins', margin=0, grid=[1000,3000], width=3000,
         rows=[[(1000,1),(3000,1)]], cellMargins=[[(50,150),(300,400)]]),
]

def paragraph(text):
    return '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="12"/></w:rPr><w:t>'+escape(text)+'</w:t></w:r></w:p>'

def generate(cases=CASES, stem='source'):
    body = ''
    for case in cases:
        body += paragraph(case['name'])
        body += f'<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="{case["width"]}"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'
        body += ''.join(f'<w:{side} w:type="dxa" w:w="{case["margin"]}"/>' for side in ['left','right'])
        body += '</w:tblCellMar></w:tblPr><w:tblGrid>'+''.join(f'<w:gridCol w:w="{v}"/>' for v in case['grid'])+'</w:tblGrid>'
        for row_index,row in enumerate(case['rows']):
            body += '<w:tr>'
            for column,(width,span) in enumerate(row):
                body += f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{width}"/>'
                if span > 1:
                    body += f'<w:gridSpan w:val="{span}"/>'
                color = ['336699','CC6633','669933','AABBCC'][column]
                body += f'<w:shd w:val="clear" w:fill="{color}"/>'
                if case.get('cellMargins'):
                    left,right = case['cellMargins'][row_index][column]
                    body += f'<w:tcMar><w:left w:type="dxa" w:w="{left}"/><w:right w:type="dxa" w:w="{right}"/></w:tcMar>'
                body += '</w:tcPr>'+paragraph(chr(65+column))+'</w:tc>'
            body += '</w:tr>'
        body += '</w:tbl>'
    body += paragraph('')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    # Reuse only this repository's original minimal package infrastructure.
    with ZipFile(ROOT/'public/fixtures/fixed-table-preference.docx') as z:
        parts = {n:z.read(n) for n in z.namelist()}
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT/f'{stem}.docx','w',ZIP_DEFLATED) as z:
        for name,data in parts.items():
            z.writestr(name,data)
    (OUT/('cases.json' if stem == 'source' else f'{stem}-cases.json')).write_text(json.dumps(cases,indent=2)+'\n')

if __name__ == '__main__':
    import sys
    if '--rows-only' in sys.argv:
        generate(CASES[6:], 'rows')
    elif '--margins-only' in sys.argv:
        generate(MARGIN_CASES, 'margins')
    else:
        generate()
