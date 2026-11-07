"""Original nested reset controls for full numbering level overrides."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
from numbering_override_index_fixture import W,level
OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/numbering-override-sequences'
def main():
 with ZipFile(OUT/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 rows=json.loads((OUT/'cases.json').read_text());cases=[r for r in rows if r['label'].endswith('.1') and r['case']<=12]
 abstracts=[];nums=[];paras=[];record=[]
 for c in cases:
  i=c['case'];aid=2000+i;nid=100+i
  abstracts.append(f'<w:abstractNum w:abstractNumId="{aid}"><w:nsid w:val="{aid:08X}"/><w:multiLevelType w:val="multilevel"/>'+level(0,'P%1.',2)+level(1,'B%2.',4)+level(2,'N%1.%2.%3',6)+'</w:abstractNum>')
  child=level(2 if c['kind']=='mismatched' else 1,'D%3.' if c['kind']=='deeper' else 'O%2.',3 if c['childStart'] is None else c['childStart'])
  if c['childStart'] is None:child=child.replace('<w:start w:val="3"/>','')
  start='' if c['override'] is None else f'<w:startOverride w:val="{c["override"]}"/>'
  nums.append(f'<w:num w:numId="{nid}"><w:abstractNumId w:val="{aid}"/><w:lvlOverride w:ilvl="1">{start}{child}</w:lvlOverride></w:num>')
  for j,idx in enumerate([0,1,1,0,1],1):
   label=f'S{i:02}.{j}';record.append({**c,'label':label,'numId':str(nid),'level':idx})
   paras.append(f'<w:p><w:pPr><w:numPr><w:ilvl w:val="{idx}"/><w:numId w:val="{nid}"/></w:numPr><w:spacing w:after="40"/></w:pPr><w:r><w:t>{label}</w:t></w:r></w:p>')
 s=parts['word/document.xml'].decode();sect=s[s.index('<w:sectPr>'):s.index('</w:body>')]
 parts['word/document.xml']=(f'<w:document xmlns:w="{W}"><w:body>'+''.join(paras)+sect+'</w:body></w:document>').encode()
 parts['word/numbering.xml']=(f'<w:numbering xmlns:w="{W}">'+''.join(abstracts)+''.join(nums)+'</w:numbering>').encode()
 with ZipFile(OUT/'nested.docx','w',ZIP_DEFLATED) as z:
  for n,d in parts.items():z.writestr(n,d)
 (OUT/'nested-cases.json').write_text(json.dumps(record,indent=2)+'\n')
if __name__=='__main__':main()
