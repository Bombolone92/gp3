"""Original style/list precedence probes, authored directly as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
cases=[
 dict(label='No indent declarations'),
 dict(label='Ancestor first line',base={'firstLine':720}),
 dict(label='Numbering style first line',number={'firstLine':720}),
 dict(label='Derived first line',leaf={'firstLine':720}),
 dict(label='Direct first line',direct={'firstLine':720}),
 dict(label='Ancestor hanging',base={'hanging':720}),
 dict(label='Numbering style hanging',number={'hanging':720}),
 dict(label='Derived hanging',leaf={'hanging':720}),
 dict(label='Direct hanging',direct={'hanging':720}),
 dict(label='Ancestor left',base={'left':2880}),
 dict(label='Numbering style left',number={'left':2880}),
 dict(label='Derived left',leaf={'left':2880}),
 dict(label='Direct left',direct={'left':2880}),
 dict(label='Direct list ancestor first',base={'firstLine':720},directList=True),
 dict(label='Direct list numbering-style first',number={'firstLine':720},directList=True),
 dict(label='Direct list derived first',leaf={'firstLine':720},directList=True),
 dict(label='Direct list direct first',direct={'firstLine':720},directList=True),
 dict(label='Numbering style first zero',number={'firstLine':0}),
 dict(label='Numbering style left zero',number={'left':0}),
 dict(label='Ancestor hanging then numbered first',base={'left':2880,'hanging':720},number={'firstLine':720}),
 dict(label='List only in leaf',number={'firstLine':720},leafList=True),
 dict(label='List repeated in leaf',number={'firstLine':720},repeatList=True),
 dict(label='Normal ancestor first',normal=True),
 dict(label='Direct list Normal ancestor',normal=True,directList=True),
]
def ind(attrs):
 return '<w:ind '+ ' '.join(f'w:{k}="{v}"' for k,v in attrs.items())+'/>' if attrs else ''
def num(i):return f'<w:numPr><w:numId w:val="{i}"/></w:numPr>'
styles=f'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="720"/></w:pPr></w:style>'
styles+='<w:style w:type="paragraph" w:styleId="Label"><w:name w:val="Label"/></w:style>'
numbering='';body=''
for i,c in enumerate(cases,1):
 c['id']=f'A{i:02}';c['numId']=str(i)
 base,number,leaf=[f'{v}{i}' for v in ['Base','Number','Leaf']]
 for name,parent,props in [(base,'Normal' if c.get('normal') else None,ind(c.get('base'))),(number,base,('' if c.get('leafList') else num(i))+ind(c.get('number'))),(leaf,number,(num(i) if c.get('leafList') or c.get('repeatList') else '')+ind(c.get('leaf')))]:
  styles+=f'<w:style w:type="paragraph" w:styleId="{name}"><w:name w:val="{name}"/>'+ (f'<w:basedOn w:val="{parent}"/>' if parent else '')+f'<w:pPr>{props}</w:pPr></w:style>'
 numbering+=f'<w:abstractNum w:abstractNumId="{i}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="{leaf if c.get("leafList") else number}"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="1440"/></w:tabs><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
 label=f'{c["id"]}: {c["label"]}'
 body+=f'<w:p><w:pPr><w:pStyle w:val="Label"/>'+('<w:pageBreakBefore/>' if (i-1)%8==0 and i>1 else '')+f'</w:pPr><w:r><w:t>{label}</w:t></w:r></w:p>'
 body+=f'<w:p><w:pPr><w:pStyle w:val="{leaf}"/>'+ (num(i) if c.get('directList') else '')+'<w:spacing w:after="240"/>'+ind(c.get('direct'))+f'</w:pPr><w:r><w:t>First{c["id"]}</w:t><w:br/><w:t>Second{c["id"]}</w:t></w:r></w:p>'
numbering+=''.join(f'<w:num w:numId="{i}"><w:abstractNumId w:val="{i}"/></w:num>' for i in range(1,len(cases)+1))
parts={
 '[Content_Types].xml':f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join(f'<Override PartName="/word/{name}.xml" ContentType="{CT}{kind}+xml"/>' for name,kind in [('document','document.main'),('styles','styles'),('numbering','numbering')])+'</Types>',
 '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/><Relationship Id="numbers" Type="{R}/numbering" Target="numbering.xml"/></Relationships>',
 'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>{styles}</w:styles>',
 'word/numbering.xml':f'<w:numbering xmlns:w="{W}">{numbering}</w:numbering>',
 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
out=ROOT/'public/fixtures/list-style-indents.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(ZipInfo(name,(2026,9,18,0,0,0)),data,compress_type=ZIP_DEFLATED)
refs=ROOT/'tests/fixtures/list-style-indents';refs.mkdir(exist_ok=True)
(refs/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print(out)
