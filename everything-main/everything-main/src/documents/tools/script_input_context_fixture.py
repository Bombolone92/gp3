from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
repo=Path(__file__).resolve().parents[1]
root=repo/'tests/fixtures/script-input-context';root.mkdir(exist_ok=True)
with ZipFile(repo/'tests/fixtures/script-input/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
steps=[['X','א','1'],['א','X','1'],['क',' ','A'],['Aא1'],['X\nא'],['X','\n','א'],['א\nX'],['א','\n','X'],['\n'],['\n','א'],['A\n\nא'],['א','\n','1']]
steps += [['क',' '],['क',' ',' '],['क','1',' '],['क','.', ' '],['क','(',')',' '],['क','\t',' '],['क','\u0300',' '],['क','A',' '],['क','א',' '],['क','\n',' '],['क','  A'],['क','  א'],['ก',' '],['क','🙂',' '],['क','1  '],['क',' A ']]
steps += [[s] for s in ['क1 ', 'क A','क א','क(1)','क🙂','क  A','क  א','क. A','क1A','क1א','क(א)','क(A)','क\tA','क\tא']]
cases=[];body=[]
size='<w:sz w:val="20"/><w:szCs w:val="32"/>'
styles=f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>{size}</w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
for flag in ['cs','rtl']:styles+=f'<w:style w:type="paragraph" w:styleId="{flag}"><w:name w:val="{flag}"/><w:basedOn w:val="Normal"/><w:rPr><w:{flag}/></w:rPr></w:style>'
parts['word/styles.xml']=(styles+'</w:styles>').encode()
for flag in ['', 'cs','rtl']:
 for inherited in [False,True]:
  for actions in steps:
   cases.append(dict(flag=flag,inherited=inherited,steps=actions))
   props=(f'<w:{flag}/>' if flag else '')
   ppr=f'<w:pStyle w:val="{flag or "Normal"}"/>' if inherited else f'<w:rPr>{size}{props}</w:rPr>'
   rpr='' if inherited else size+props
   body.append(f'<w:p><w:pPr>{ppr}</w:pPr><w:r><w:rPr>{rpr}</w:rPr><w:t>AB</w:t></w:r></w:p>')
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}<w:sectPr/></w:body></w:document>'.encode()
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(root/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf-8')
