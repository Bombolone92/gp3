"""Original OOXML controls for trailing-space kerning and line-fit boundaries."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from html import escape
import json
repo=Path(__file__).resolve().parents[1]
dest=repo/'tests/fixtures/trailing-space-kerning';dest.mkdir(exist_ok=True)
with ZipFile(repo/'tests/fixtures/table-row-keep-next/none.docx') as z:parts={n:z.read(n) for n in z.namelist()}
cases=[]
def add(id,**kw):cases.append(dict(id=id,word='OPERATIONAL',font='Arial',bold=True,italic=False,width=2875,mode='fixed',tail='space',kern=2,**kw))
for tail in ['space','terminal','break','tab','double','split','color','font','off-space']:
 add(tail);cases[-1]['tail']=tail
for id,k in [('kern-off',0),('kern-above',41)]:add(id);cases[-1]['kern']=k
for tail in ['space','terminal']:
 add('auto-'+tail);cases[-1].update(tail=tail,mode='autofit',width=100)
for name,font,bold,italic,width in [('regular','Arial',False,False,1238),('italic','Times New Roman',False,True,1157),('calibri','Calibri',False,False,1001)]:
 for tail in ['space','terminal']:
  add(name+'-'+tail);cases[-1].update(word='TOTAL',font=font,bold=bold,italic=italic,width=width,tail=tail)
def run(text,c,extra='',font=None,kern=None):
 return '<w:r><w:rPr>'+f'<w:rFonts w:ascii="{font or c["font"]}" w:hAnsi="{font or c["font"]}"/>'+('<w:b/>' if c['bold'] else '')+('<w:i/>' if c['italic'] else '')+f'<w:sz w:val="40"/><w:kern w:val="{c["kern"] if kern is None else kern}"/>'+extra+'</w:rPr><w:t xml:space="preserve">'+escape(text)+'</w:t></w:r>'
body=''
for i,c in enumerate(cases):
 t=c['tail'];word=c['word'];r=run(word,c)
 if t in ['space','double']:r=run(word+('  ' if t=='double' else ' ')+'NEXT',c)
 elif t in ['split','color','font','off-space']:r+=run(' NEXT',c,extra='<w:color w:val="CC0000"/>' if t=='color' else '',font='Courier New' if t=='font' else None,kern=0 if t=='off-space' else None)
 elif t in ['break','tab']:r+='<w:r>'+('<w:br/>' if t=='break' else '<w:tab/>')+'</w:r>'+run('NEXT',c)
 width=c['width'];body+=f'<w:p><w:r><w:t>Case {i+1}: {c["id"]}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="{width}" w:type="dxa"/><w:tblLayout w:type="{c["mode"]}"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+f'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="{width}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>{r}</w:p></w:tc></w:tr></w:tbl>'
body+='<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(dest/'control.docx','w',ZIP_DEFLATED) as z:
 for n,v in parts.items():z.writestr(n,v)
(dest/'cases.json').write_text(json.dumps(cases))
