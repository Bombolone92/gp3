from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape
repo=Path(__file__).resolve().parents[1]
out=repo/'tests/fixtures/cell-text-direction/font-sizes.docx'
with ZipFile(repo/'tests/fixtures/cell-text-direction/mode15.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'.encode()
body=''
text='Clear text for measuring'
for index,size in enumerate([8,8.5,9,9.5,10,10.5,11,12]):
    body+=f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if index else ""}</w:pPr><w:r><w:t>Size {size}</w:t></w:r></w:p>'
    cells=''
    for direction in ['lrTb','btLr','tbRl']:
        cells+=f'<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/><w:tcMar>'+''.join(f'<w:{side} w:w="120" w:type="dxa"/>' for side in ['top','left','bottom','right'])+f'</w:tcMar><w:textDirection w:val="{direction}"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="{int(size*2)}"/></w:rPr><w:t>{escape(text)}</w:t></w:r></w:p></w:tc>'
    borders='<w:tblBorders>'+''.join(f'<w:{side} w:val="single" w:sz="8" w:color="336699"/>' for side in ['top','left','bottom','right','insideH','insideV'])+'</w:tblBorders>'
    body+='<w:tbl><w:tblPr><w:tblW w:w="8640" w:type="dxa"/>'+borders+'<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>'+('<w:gridCol w:w="2880"/>'*3)+'</w:tblGrid><w:tr><w:trPr><w:trHeight w:val="5760" w:hRule="exact"/></w:trPr>'+cells+'</w:tr></w:tbl>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(out,'w',ZIP_DEFLATED) as z:
    for n,b in parts.items():z.writestr(n,b)
print(out)
