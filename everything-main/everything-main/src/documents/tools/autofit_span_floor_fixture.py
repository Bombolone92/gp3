from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED,ZipInfo
import sys,json
repo=Path(__file__).resolve().parents[1];sys.path.insert(0,str(repo/'tools'))
from canvas_first_section_fixture import parts as base,W,R,CT
root=repo/'tests/fixtures/autofit-span-floor';root.mkdir(exist_ok=True)
cases=[]
for available in [6000,8400]:
 for length in [0,3,7]:cases.append(dict(preferences=[1100,1300,900,2700],span=2,length=length,margin=60,available=available,nowrap=False))
for margin in [0,160]:cases.append(dict(preferences=[1900,900,1400,1800],span=2,length=4,margin=margin,available=8400,nowrap=False))
for available in [6000,8400]:
 for length in [0,4]:cases.append(dict(preferences=[1200,900,1500,2400],span=3,length=length,margin=100,available=available,nowrap=False))
for available in [6000,8400]:cases.append(dict(preferences=[1600,1400,600,2400],span=2,length=2,margin=80,available=available,nowrap=True))
for available in [6000,8400]:
 parts=dict(base)
 parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
 parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
 parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
 parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
 body=[];selected=[c for c in cases if c['available']==available]
 def cell(text,width,span=1,nowrap=False):
  return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>'+ (f'<w:gridSpan w:val="{span}"/>'if span>1 else '')+('<w:noWrap/>'if nowrap else '')+f'</w:tcPr><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>'
 for i,c in enumerate(selected):
  body.append('<w:p><w:pPr>'+('<w:pageBreakBefore/>'if i else '')+f'</w:pPr><w:r><w:t>Span writing floor {i+1}</w:t></w:r></w:p>')
  prefs=c['preferences'];span=c['span'];margin=c['margin'];body.append(f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblCellMar><w:left w:w="{margin}" w:type="dxa"/><w:right w:w="{margin}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'+''.join(f'<w:gridCol w:w="{p}"/>'for p in prefs)+'</w:tblGrid>')
  upper=cell('M'*(20 if span==2 else 28),sum(prefs[:span]),span)+''.join(cell('Right words'if j==3 else '',prefs[j])for j in range(span,4))
  lower=cell('M'*c['length'],prefs[0],nowrap=c['nowrap'])+(cell('II',prefs[1])+cell('Across',sum(prefs[2:]),2)if span==3 else cell('Across',sum(prefs[1:]),3))
  body.extend(['<w:tr>'+upper+'</w:tr>','<w:tr>'+lower+'</w:tr>','</w:tbl>'])
 body.append(f'<w:p/><w:sectPr><w:pgSz w:w="{available+1440}" w:h="10080"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>')
 parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
 name='narrow'if available==6000 else 'wide'
 with ZipFile(root/(name+'.docx'),'w',ZIP_DEFLATED)as z:
  for n,b in parts.items():z.writestr(n,b)
 (root/(name+'-cases.json')).write_text(json.dumps(selected,indent=2)+'\n')
