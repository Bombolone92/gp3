"""Original controls for table-cell textDirection rotation and row sizing."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from html import escape
repo=Path(__file__).resolve().parents[1];folder=repo/'tests/fixtures/cell-text-direction';folder.mkdir(exist_ok=True)
with ZipFile(repo/'tests/fixtures/cell-end-context/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
def para(text,jc='left'):
 return f'<w:p><w:pPr><w:jc w:val="{jc}"/></w:pPr><w:r><w:t>{escape(text)}</w:t></w:r></w:p>'
borders='<w:tblBorders>'+''.join(f'<w:{s} w:val="single" w:sz="8" w:color="336699"/>' for s in ['top','left','bottom','right','insideH','insideV'])+'</w:tblBorders>'
cases=[('top-exact','top','left','exact',2160,['Alpha beta']),('center-exact','center','center','exact',2160,['Alpha beta']),('bottom-exact','bottom','right','exact',2160,['Alpha beta']),('wrap-exact','top','left','exact',2160,['One two three four five six seven eight nine ten eleven twelve']),('paragraphs','center','left','exact',2160,['First paragraph','Second paragraph']),('natural','top','left',None,0,['Alpha beta']),('minimum','bottom','center','atLeast',1440,['Alpha beta']),('small-exact','top','left','exact',480,['Alpha beta'])]
body=''
for i,(name,vertical,jc,rule,height,texts) in enumerate(cases):
 body+=f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>{name}</w:t></w:r></w:p>'
 cells=''
 for direction in ['lrTb','btLr','tbRl']:
  pr=f'<w:tcPr><w:tcW w:w="2160" w:type="dxa"/><w:tcMar><w:top w:w="180" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="300" w:type="dxa"/><w:right w:w="240" w:type="dxa"/></w:tcMar><w:textDirection w:val="{direction}"/><w:vAlign w:val="{vertical}"/></w:tcPr>'
  cells+='<w:tc>'+pr+''.join(para(t,jc) for t in texts)+'</w:tc>'
 rowpr='<w:trPr><w:cantSplit/>'+ (f'<w:trHeight w:val="{height}" w:hRule="{rule}"/>' if rule else '')+'</w:trPr>'
 body+='<w:tbl><w:tblPr><w:tblW w:w="6480" w:type="dxa"/>'+borders+'<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>'+('<w:gridCol w:w="2160"/>'*3)+'</w:tblGrid><w:tr>'+rowpr+cells+'</w:tr></w:tbl>'+para('After table')
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
