"""Original reference controls for paragraph writing areas outside the paper."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape
repo=Path(__file__).resolve().parents[1]
folder=repo/'tests/fixtures/body-overflow-indents'
folder.mkdir(exist_ok=True)
with ZipFile(repo/'tests/fixtures/cell-end-context/control.docx') as z:
 parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
cases=[('right-short',0,-7200,'Short contact line'),('right-long',0,-7200,' '.join(f'word{i:02}' for i in range(90))),('left-long',-2520,0,' '.join(f'left{i:02}' for i in range(50))),('both-long',-2520,-7200,' '.join(f'both{i:02}' for i in range(90))),('right-aligned',0,-7200,'Right aligned text'),('centered',0,-7200,'Centered text')]
body=''
for i,(name,left,right,text) in enumerate(cases):
 body+=f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>{name}</w:t></w:r></w:p>'
 align='right' if name=='right-aligned' else 'center' if name=='centered' else 'left'
 body+=f'<w:p><w:pPr><w:ind w:left="{left}" w:right="{right}"/><w:jc w:val="{align}"/></w:pPr><w:r><w:t>{escape(text)}</w:t></w:r></w:p>'
 body+='<w:p><w:r><w:t>After paragraph</w:t></w:r></w:p>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
