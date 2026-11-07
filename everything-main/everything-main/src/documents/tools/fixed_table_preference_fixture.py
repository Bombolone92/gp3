"""Original fixed-table width conflicts; direct OPC/XML, no template content."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape
ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
COLORS = ['336699','CC6633','669933']

def p(text):
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:color w:val="000000"/></w:rPr><w:t>'+escape(text)+'</w:t></w:r></w:p>'

def table(kind, width, grid, rows, gap=0, before=0):
    xml = '<w:tbl><w:tblPr><w:tblW w:type="'+kind+'" w:w="'+str(width)+'"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join('<w:'+s+' w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid>'+''.join('<w:gridCol w:w="'+str(w)+'"/>' for w in grid)+'</w:tblGrid>'
    for r,cells in enumerate(rows):
        row_gap = gap if isinstance(gap,int) else gap[r]
        after = len(grid)-row_gap-sum(span for _,span in cells)
        xml += '<w:tr><w:trPr>'+('<w:gridBefore w:val="'+str(row_gap)+'"/>' if row_gap else '')+('<w:gridAfter w:val="'+str(after)+'"/>' if after else '')+('<w:wBefore w:type="dxa" w:w="'+str(before)+'"/>' if row_gap else '')+('<w:wAfter w:type="dxa" w:w="'+str(sum(grid[-after:]))+'"/>' if after else '')+'<w:trHeight w:val="480" w:hRule="exact"/></w:trPr>'
        for c,(w,span) in enumerate(cells):
            xml += '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="'+str(w)+'"/>'+('<w:gridSpan w:val="'+str(span)+'"/>' if span>1 else '')+'<w:shd w:val="clear" w:fill="'+COLORS[c]+'"/></w:tcPr>'+p(chr(65+c))+'</w:tc>'
        xml += '</w:tr>'
    return xml+'</w:tbl>'

cases = [
 ('larger absolute preference', 'dxa',4320,[1440,2880],[[(1000,1),(2000,1)]],0,0),
 ('larger percentage preference','pct',2500,[1440,2880],[[(1000,1),(2000,1)]],0,0),
 ('automatic preference','auto',0,[1440,2880],[[(1000,1),(2000,1)]],0,0),
 ('nil preference','nil',0,[1440,2880],[[(1000,1),(2000,1)]],0,0),
 ('smaller preference','dxa',2400,[1440,2880],[[(1000,1),(2000,1)]],0,0),
 ('later row conflict','dxa',4320,[1440,2880],[[(1000,1),(2000,1)],[(1800,1),(1000,1)]],0,0),
 ('merged cell conflict','dxa',4320,[800,1600,1200],[[(2000,2),(1000,1)],[(1000,1),(1500,1),(1000,1)]],0,0),
 ('omitted leading column','dxa',4320,[600,1000,2000],[[(1000,1),(2000,1)]],1,600),
 ('different stored grid','dxa',4320,[3000,1000],[[(1000,1),(2000,1)]],0,0),
 ('leading gap then full row','dxa',4320,[600,1000,2000],[[(1000,1),(2000,1)],[(600,1),(1000,1),(2000,1)]],[1,0],600),
 ('full row then leading gap','dxa',4320,[600,1000,2000],[[(600,1),(1000,1),(2000,1)],[(1000,1),(2000,1)]],[0,1],600),
 ('omitted trailing column','dxa',4320,[1000,2000,600],[[(1000,1),(2000,1)]],0,0),
 ('trailing gap then full row','dxa',4320,[1000,2000,600],[[(1000,1),(2000,1)],[(1000,1),(2000,1),(600,1)]],0,0),
 ('leading gap with reduction','dxa',2400,[600,1000,2000],[[(1000,1),(2000,1)]],1,600),
 ('trailing gap with reduction','dxa',2400,[1000,2000,600],[[(1000,1),(2000,1)]],0,0),
]
body = ''.join(p(name)+table(kind,width,grid,rows,gap,before) for name,kind,width,grid,rows,gap,before in cases)
body += p('')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="1800" w:bottom="720" w:left="1800" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT/'public/fixtures/numeric-page-fields.docx') as z:
    parts = {n:z.read(n) for n in ['[Content_Types].xml','_rels/.rels','word/styles.xml','word/settings.xml','word/_rels/document.xml.rels']}
parts['word/footer.xml']=('<w:ftr xmlns:w="'+W+'"><w:p/></w:ftr>').encode()
parts['word/document.xml']=('<w:document xmlns:w="'+W+'"><w:body>'+body+'</w:body></w:document>').encode()
with ZipFile(ROOT/'public/fixtures/fixed-table-preference.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items(): z.writestr(name,data)
