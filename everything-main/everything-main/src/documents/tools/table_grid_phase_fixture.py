"""Author textless multirow controls for table-border device phases."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json,hashlib,sys
from canvas_first_section_fixture import parts as base,W
root=Path(__file__).resolve().parents[1]
out=root/'tests/fixtures/table-grid-phase';out.mkdir(exist_ok=True)
holdout = sys.argv[1:] == ['--holdout']
assert sys.argv[1:] in ([], ['--holdout'])
name = 'holdout' if holdout else 'control'
parts=dict(base)
if holdout:
 parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
 parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>','<Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>')
 parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
p='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>'
cases=[];body=p
for i,(x,y,size) in enumerate(([(720,1967,4),(5400,1972,6),(10080,1980,18)] if holdout else [(720,1966,4),(5400,1970,6),(10080,1978,18)])):
 width=3300;heights=[1180,1162,900,1350,1043,1365] if holdout else [1180]*6
 borders=''.join(f'<w:{side} w:val="single" w:sz="{size}" w:color="000000"/>' for side in ['top','left','bottom','right','insideH','insideV'])
 margins=''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])
 pr=f'<w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="{x}" w:tblpY="{y}"/><w:tblW w:w="{width}" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr>'
 rows=''
 for height in heights:
  cells=''.join(f'<w:tc><w:tcPr><w:tcW w:w="{width//2}" w:type="dxa"/></w:tcPr>{p}</w:tc>' for _ in range(2))
  rows+=f'<w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="exact"/></w:trPr>{cells}</w:tr>'
 body+=f'<w:tbl>{pr}<w:tblGrid><w:gridCol w:w="{width//2}"/><w:gridCol w:w="{width//2}"/></w:tblGrid>{rows}</w:tbl>'+p
 cases.append({'id':i+1,'xTwips':x,'yTwips':y,'widthTwips':width,'rowHeightsTwips':heights,'borderSize':size})
body+='<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
with ZipFile(out/(name+'.docx'),'w',ZIP_DEFLATED) as z:
 for part_name,value in parts.items():
  info=ZipInfo(part_name,(2026,10,10,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,'<?xml version="1.0" encoding="UTF-8"?>'+value)
(out/('holdout-cases.json' if holdout else 'cases.json')).write_text(json.dumps(cases,indent=2)+'\n')
print(hashlib.sha256((out/(name+'.docx')).read_bytes()).hexdigest())
