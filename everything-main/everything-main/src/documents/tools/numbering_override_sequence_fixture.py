"""Original sequence controls for full numbering level overrides."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
from numbering_override_index_fixture import W,level
OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/numbering-override-sequences'
BASE=OUT.parent/'numbering-override-index/matched.docx'

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 with ZipFile(BASE) as z:parts={n:z.read(n) for n in z.namelist()}
 cases=[dict(kind=k,childStart=c,override=o) for k in ['matched','mismatched','deeper'] for c in [None,3] for o in [None,7]]
 cases += [dict(kind='shared',childStart=3,override=o) for o in [None,7]]
 cases += [dict(kind=k,childStart=3,override=7,missingBase=True) for k in ['matched','mismatched']]
 cases += [dict(kind='matched',childStart=3,override=o,absentBaseStart=True) for o in [None,7]]
 abstracts=[];instances=[];paragraphs=[];rows=[]
 for i,c in enumerate(cases,1):
  aid=1000+i;base=2*i;num=base+1
  l0='' if c.get('missingBase') else level(0,'B%1.',1)
  if c.get('absentBaseStart'):l0=l0.replace('<w:start w:val="1"/>','')
  abstracts.append(f'<w:abstractNum w:abstractNumId="{aid}"><w:nsid w:val="{aid:08X}"/><w:multiLevelType w:val="multilevel"/>'+l0+level(1,'N%1.%2',4)+'</w:abstractNum>')
  child=level(1 if c['kind']=='mismatched' else 0,'D%2.' if c['kind']=='deeper' else 'O%1.',3 if c['childStart'] is None else c['childStart'])
  if c['childStart'] is None:child=child.replace('<w:start w:val="3"/>','')
  start='' if c['override'] is None else f'<w:startOverride w:val="{c["override"]}"/>'
  instances.append(f'<w:num w:numId="{base}"><w:abstractNumId w:val="{aid}"/></w:num>')
  instances.append(f'<w:num w:numId="{num}"><w:abstractNumId w:val="{aid}"/><w:lvlOverride w:ilvl="0">{start}{child}</w:lvlOverride></w:num>')
  seq=[(base,0),(num,0),(num,0),(base,0)] if c['kind']=='shared' else [(num,0),(num,1),(num,0),(num,1)]
  for j,(nid,idx) in enumerate(seq,1):
   label=f'R{i:02}.{j}'
   rows.append(dict(case=i,label=label,numId=str(nid),level=idx,**c))
   paragraphs.append(f'<w:p><w:pPr><w:numPr><w:ilvl w:val="{idx}"/><w:numId w:val="{nid}"/></w:numPr><w:spacing w:after="40"/></w:pPr><w:r><w:t>{label}</w:t></w:r></w:p>')
 body=parts['word/document.xml'].decode();sect=body[body.index('<w:sectPr>'):body.index('</w:body>')]
 parts['word/document.xml']=(f'<w:document xmlns:w="{W}"><w:body>'+''.join(paragraphs)+sect+'</w:body></w:document>').encode()
 parts['word/numbering.xml']=(f'<w:numbering xmlns:w="{W}">'+''.join(abstracts)+''.join(instances)+'</w:numbering>').encode()
 with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
  for n,d in parts.items():z.writestr(n,d)
 (OUT/'cases.json').write_text(json.dumps(rows,indent=2)+'\n')
if __name__=='__main__':main()
