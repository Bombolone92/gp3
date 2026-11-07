"""Original exact-row page-boundary controls; no renderer or corpus inputs."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import argparse
ROOT=Path(__file__).resolve().parents[1]
CASES=[dict(name=name,height=height,border=border,bottom=bottom) for name,height,border,bottom in [
 ('borderless',400,0,0),('top-2pt',400,16,0),('shorter-1twip',399,16,0),
 ('taller-1twip',401,16,0),('taller-2twip',402,16,0),('top-4pt',400,32,0),
 ('bottom-2pt',400,0,16),('both-2pt',400,16,16)]]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
SECTION='<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/>'
def generate(destination):
 destination.mkdir(parents=True,exist_ok=True);body='';labels=[]
 for group,case in enumerate(CASES):
  body+='<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>'+'<w:gridCol w:w="2400"/>'*3+'</w:tblGrid>'
  for row in range(37):
   label=f'R{group}{row:03d}';labels.append(dict(label=label,case=case['name'],row=row))
   body+=f'<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="{case["height"]}" w:hRule="exact"/></w:trPr>'
   for col in range(3):
    borders=''
    if col==2:
     for side in ['top','bottom']:
      size=case['border'] if side=='top' else case['bottom']
      if size:borders+=f'<w:{side} w:val="single" w:sz="{size}" w:color="224466"/>'
    props=f'<w:tcBorders>{borders}</w:tcBorders>' if borders else ''
    if col==1:props+='<w:shd w:val="clear" w:fill="DDEEFF"/>'
    paragraph=f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>{label}</w:t></w:r></w:p>' if col==0 else '<w:p/>'
    body+=f'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>{props}</w:tcPr>{paragraph}</w:tc>'
   body+='</w:tr>'
  body+='</w:tbl>'
  if group<len(CASES)-1:body+=f'<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/>{SECTION}</w:sectPr></w:pPr></w:p>'
  else:body+='<w:p/>'+f'<w:sectPr>{SECTION}</w:sectPr>'
 with ZipFile(ROOT/'public/fixtures/empty-table-fragment.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
 path=destination/'exact-row-page-fit-20261004.docx'
 with ZipFile(path,'w',ZIP_DEFLATED) as z:
  for n,data in parts.items():
   info=ZipInfo(n,(2026,10,4,6,0,0));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,data,compress_type=ZIP_DEFLATED)
 (destination/'cases.json').write_text(json.dumps(dict(cases=CASES,labels=labels),indent=2)+'\n')
 return path
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-dir',type=Path,default=ROOT/'tests/fixtures/exact-row-page-fit');args=parser.parse_args();print(generate(args.output_dir))
