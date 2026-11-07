"""Original OOXML: AutoFit tab minima across compatibility modes and intervals."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import sys,json

from canvas_first_section_fixture import parts as base,W,R,CT
outdir=Path(__file__).resolve().parents[1]/'tests/fixtures/autofit-tab-minimum'
outdir.mkdir(exist_ok=True)
mode=int(sys.argv[1])
interval=int(sys.argv[2])
out=outdir/f'mode{mode}-{interval}.docx'
cases=[dict(indent=i,tabs=1,stop=720) for i in [0,180,360,540,720,900]]
cases += [dict(indent=540,tabs=n,stop=s) for n,s in [(2,720),(3,720),(1,360),(1,1440)]]
cases += [dict(indent=540,tabs=1,stop=720,custom=pos,alignment=a) for pos,a in [(720,'left'),(1440,'left'),(1440,'right'),(1440,'center')]]
cases += [dict(indent=540,tabs=1,stop=720,text=t) for t in ['X','MMMM','X<tab>X']]
cases += [dict(indent=i,tabs=1,stop=720,prefix=p,first=f,right=r) for i,p,f,r in [(540,'X',0,0),(540,'MMMM',0,0),(0,'X',0,0),(0,'MMMMMMMM',0,0),(0,'',540,0),(540,'',-540,0),(540,'',180,0),(0,'',0,540),(-180,'',0,0)]]
cases += [dict(indent=0,tabs=1,stop=720,text='X',custom=1440,alignment=a) for a in ['left','right','center','decimal']]
cases += [dict(indent=0,tabs=1,stop=720,text=t,custom=p,alignment='decimal') for t,p in [('',1440),('12',1440),('12.3',1440),('$12.3',1440),('X12.3',1440),('X',720),('12.3',720)]]
cases += [dict(indent=0,tabs=1,stop=720,text='12.3',custom=p,alignment='decimal') for p in [900,1260]]
parts=dict(base);body=[]
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:defaultTabStop w:val="{interval}"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
for i,c in enumerate(cases):
 body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i and i % 6 == 0 else ""}</w:pPr><w:r><w:t>Case {i+1}</w:t></w:r></w:p>')
 tabpr=f'<w:tabs><w:tab w:val="{c["alignment"]}" w:pos="{c["custom"]}"/></w:tabs>' if 'custom' in c else ''
 content='<w:t>'+c.get('prefix','')+'</w:t>'+'<w:tab/>'*c['tabs']+('<w:t>'+c.get('text','').replace('<tab>','</w:t><w:tab/><w:t>')+'</w:t>')
 extra=f' w:right="{c.get("right",0)}"'+(f' w:firstLine="{c.get("first",0)}"' if c.get('first',0)>=0 else f' w:hanging="{-c["first"]}"')
 middle=f'<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="{c["stop"]}"/></w:tabs><w:ind w:left="{c["indent"]}"{extra}/></w:pPr><w:r>{content}</w:r></w:p>'
 # Explicit interval probe uses the first stop; custom cases replace it.
 if tabpr:middle=middle.replace(f'<w:tabs><w:tab w:val="left" w:pos="{c["stop"]}"/></w:tabs>',tabpr)
 elif c['stop']==720:middle=middle.replace('<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>','')
 cells=''.join(f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{width}"/></w:tcPr>{content}</w:tc>' for width,content in [(2000,'<w:p><w:r><w:t>A</w:t></w:r></w:p>'),(200,middle),(2000,'<w:p><w:r><w:t>B</w:t></w:r></w:p>')])
 body.append('<w:tbl><w:tblPr><w:tblW w:w="4200" w:type="dxa"/><w:tblCellMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="200"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>'+cells+'</w:tr></w:tbl>')
body.append('<w:p/><w:sectPr><w:pgSz w:w="7200" w:h="8000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for n,b in parts.items():
  info=ZipInfo(n,(2026,9,27,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,b)
(outdir/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
