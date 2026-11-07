"""Original controls distinguishing terminal page-break run and paragraph-mark metrics."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
with ZipFile(root/'public/fixtures/terminal-break-paragraph-300.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
for name,run,mark,explicit,split,text in [('inherited',24,4,False,False,''),('explicit',24,4,True,False,''),('large-mark',4,24,True,False,''),('split',24,4,True,True,''),('text',24,4,True,False,'X'),('line',24,4,True,False,'LINE'),('small-text',24,4,True,False,'SMALL'),('spaces',24,4,True,False,'SPACE')]:
 def font(s):return f'<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="{s*2}"/>'
 before='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="6240" w:lineRule="exact"/></w:pPr><w:r><w:rPr>'+font(12)+'</w:rPr><w:t>Before</w:t></w:r></w:p>'
 br='<w:br/>' if text=='LINE' else '<w:br w:type="page"/>'
 lead=('<w:r><w:rPr>'+font(12)+'</w:rPr>'+('<w:t>X</w:t>' if text=='SMALL' else '<w:t xml:space="preserve"> </w:t>')+'</w:r>') if text in ('SMALL','SPACE') else ''
 body=before+'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr>'+font(mark)+'</w:rPr></w:pPr>'+lead+'<w:r>'+('<w:rPr>'+font(run)+'</w:rPr>' if explicit else '')+(f'<w:t>{text}</w:t>' if text and text not in ('LINE','SMALL','SPACE') else '')+br+'</w:r></w:p><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr>'+font(12)+'</w:rPr><w:t>After</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="6000" w:h="8000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
 parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
 parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr>{font(run)}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'.encode()
 parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat>'+ ('<w:splitPgBreakAndParaMark/>' if split else '')+'</w:compat></w:settings>'
 parts['word/settings.xml']=parts['word/settings.xml'].encode()
 with ZipFile(root/f'public/fixtures/break-metrics-{name}.docx','w',ZIP_DEFLATED) as z:
  for n,d in parts.items():z.writestr(n,d)
