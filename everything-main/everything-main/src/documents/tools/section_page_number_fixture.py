"""Original section numbering probes built from our original page-story OPC."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json,re
ROOT=Path(__file__).resolve().parents[1]
with ZipFile(ROOT/'tests/fixtures/page-stories/footer-variants.docx') as z:
 parts={n:z.read(n).decode() for n in z.namelist()}
cases=[
 ('Roman start', 'lowerRoman',1,2,False),
 ('Absent numbering',None,None,1,False),
 ('Roman continuation','lowerRoman',None,1,False),
 ('Even restart first page','decimal',8,2,True),
 ('Zero restart','decimal',0,2,False),
 ('Upper Roman','upperRoman',49,2,False),
 ('Lower letters','lowerLetter',26,3,False),
 ('Upper letters','upperLetter',28,1,False),
 ('Leading zero','decimalZero',3,2,False),
 ('Large Roman','lowerRoman',4000,1,False),
 ('Roman zero','lowerRoman',0,1,False),
 ('Letter zero','upperLetter',0,1,False),
 ('Empty numbering','',None,1,False),
]
base=parts['word/document.xml']
original_section=re.search(r'<w:sectPr>.*?</w:sectPr>',base)[0]
body=''
for i,(label,fmt,start,pages,first) in enumerate(cases):
 section=re.sub(r'<w:titlePg/>','',original_section)
 if i:section=re.sub(r'<w:footerReference[^>]*/>','',section)
 if fmt is not None:
  attrs=(f' w:fmt="{fmt}"' if fmt else '')+(f' w:start="{start}"' if start is not None else '')
  section=section.replace('</w:sectPr>',f'<w:pgNumType{attrs}/>'+('<w:titlePg/>' if first else '')+'</w:sectPr>')
 elif first:section=section.replace('</w:sectPr>','<w:titlePg/></w:sectPr>')
 for j in range(pages):
  last=j==pages-1
  properties=('<w:pageBreakBefore/>' if j else '')+(section if last and i<len(cases)-1 else '')
  body+=f'<w:p><w:pPr>{properties}</w:pPr><w:r><w:t>{label}, page {j+1}</w:t></w:r></w:p>'
 if i==len(cases)-1:body+=section
parts['word/document.xml']=re.sub(r'<w:body>.*</w:body>',f'<w:body>{body}</w:body>',base)
for variant in ['first','even','default']:
 path=f'word/footer-{variant}.xml'
 parts[path]=parts[path].replace('</w:p>', '<w:r><w:t xml:space="preserve"> / total </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>99</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> / section </w:t></w:r><w:fldSimple w:instr="SECTIONPAGES"><w:r><w:t>99</w:t></w:r></w:fldSimple></w:p>')
out=ROOT/'public/fixtures/section-page-numbers.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(ZipInfo(name,(2026,9,18,0,0,0)),data,compress_type=ZIP_DEFLATED)
refs=ROOT/'tests/fixtures/section-page-numbers';refs.mkdir(exist_ok=True)
(refs/'cases.json').write_text(json.dumps([dict(label=l,format=f,start=s,pages=p,firstPageDifferent=b) for l,f,s,p,b in cases],indent=2)+'\n')
print(out)
# The same section restarts without duplex headers distinguish numbering from
# the reference's blank-page insertion. An initially even first section probes parity.
for name,change in [('section-page-numbers-simplex',False),('section-page-numbers-offset',True),('section-page-numbers-title-zero','title')]:
 variant=dict(parts)
 if change == 'title':
  variant['word/document.xml']=variant['word/document.xml'].replace('w:fmt="lowerRoman" w:start="1"/>','w:fmt="lowerRoman" w:start="0"/><w:titlePg/>',1)
 elif change:
  variant['word/document.xml']=variant['word/document.xml'].replace('w:fmt="lowerRoman" w:start="1"','w:fmt="lowerRoman" w:start="2"',1)
 else:
  variant['word/settings.xml']=variant['word/settings.xml'].replace('<w:evenAndOddHeaders/>','')
 with ZipFile(ROOT/f'public/fixtures/{name}.docx','w',ZIP_DEFLATED) as z:
  for part,data in variant.items():z.writestr(ZipInfo(part,(2026,9,18,0,0,0)),data,compress_type=ZIP_DEFLATED)
