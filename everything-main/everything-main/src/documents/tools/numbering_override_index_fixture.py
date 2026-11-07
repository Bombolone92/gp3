"""Original matching/conflicting numbering-override index controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/numbering-override-index'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'

def level(index,text,start=3):
 return f'<w:lvl w:ilvl="{index}"><w:start w:val="{start}"/><w:numFmt w:val="decimal"/><w:suff w:val="space"/><w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>'

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 cases=[]
 for outer,inner in [(0,1),(1,0),(1,2),(0,8)]:
  for start in [None,7]:
   for text in [f'C%{outer+1}.',f'D%{inner+1}.']:
    cases.append(dict(outer=outer,inner=inner,start=start,text=text,label=f'Row {len(cases)+1:02}'))
 for variant in ['control','matched','control-identified','matched-identified']:
  abstracts=[];instances=[];paragraphs=[]
  for i,c in enumerate(cases,1):
   identity = f'<w:nsid w:val="{i:08X}"/><w:multiLevelType w:val="multilevel"/>' if variant.endswith('-identified') else ''
   abstracts.append(f'<w:abstractNum w:abstractNumId="{i}">'+identity+''.join(level(j,f'B%{j+1}.',1) for j in range(9))+'</w:abstractNum>')
   start='' if c['start'] is None else f'<w:startOverride w:val="{c["start"]}"/>'
   instances.append(f'<w:num w:numId="{i}"><w:abstractNumId w:val="{i}"/><w:lvlOverride w:ilvl="{c["outer"]}">{start}'+level(c['inner'] if variant.startswith('control') else c['outer'],c['text'])+'</w:lvlOverride></w:num>')
   paragraphs.append(f'<w:p><w:pPr><w:numPr><w:ilvl w:val="{c["outer"]}"/><w:numId w:val="{i}"/></w:numPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>{c["label"]}</w:t></w:r></w:p>')
  parts={
   '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+''.join(f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>' for name,kind in [('document','document.main'),('styles','styles'),('numbering','numbering'),('settings','settings')])+'</Types>',
   '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
   'word/_rels/document.xml.rels':f'<Relationships xmlns="{REL}">'+''.join(f'<Relationship Id="{n}" Type="{R}/{n}" Target="{n}.xml"/>' for n in ['styles','numbering','settings'])+'</Relationships>',
   'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+''.join(paragraphs)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
   'word/numbering.xml':f'<w:numbering xmlns:w="{W}">'+''.join(abstracts)+''.join(instances)+'</w:numbering>',
   'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
   'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
  }
  with ZipFile(OUT/(variant+'.docx'),'w',ZIP_DEFLATED) as z:
   for name,data in parts.items():z.writestr(name,data)
 (OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')

if __name__=='__main__':main()
