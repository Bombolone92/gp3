"""Independent body-symbol controls with deliberately different surrounding fonts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/body-symbols'
OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[
 ('private-wingdings','Wingdings','F031'),('direct-wingdings','Wingdings','0031'),
 ('private-symbol','Symbol','F0E3'),('ordinary-arial','Arial','0041'),
 ('private-arial','Arial','F041'),('insert-after','Wingdings','F031'),
 ('replace','Wingdings','F031'),('delete','Wingdings','F031'),
 ('bold','Wingdings','F031'),('change-font','Wingdings','F031'),
 ('clear-format','Wingdings','F031'),('insert-before','Wingdings','F031'),
 ('caps-symbol','Arial','0061'),('smallcaps-symbol','Arial','0061'),
]
body='';inventory=[]
for i,(name,font,code) in enumerate(cases):
 label=f'C{i+1:02d}'
 inventory.append(dict(label=label,name=name,font=font,code=code))
 caps='<w:caps/>' if name=='caps-symbol' else '<w:smallCaps/>' if name=='smallcaps-symbol' else ''
 body+=f'<w:p><w:pPr><w:spacing w:after="120" w:line="480" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="28"/>{caps}</w:rPr><w:t xml:space="preserve">{label} L</w:t><w:sym w:font="{font}" w:char="{code}"/><w:t>R</w:t></w:r></w:p>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT/'public/fixtures/empty-table-fragment.docx') as z:parts={n:z.read(n)for n in z.namelist()}
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(OUT/'cases.json').write_text(json.dumps(inventory,indent=2)+'\n')
