"""Independent WordprocessingML tint/shade controls with deliberately wrong RGB fallbacks."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import argparse
import json
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
BASES=['4F81BD','C0504D','64BEC6','649D93','808080','FF0000','010203','FDFEFF']
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--bases', nargs=8, help='Eight independent six-digit RGB theme colors')
parser.add_argument('--output-dir', type=Path, help='Write control.docx and cases.json here')
parser.add_argument('--full-shades', action='store_true', help='All 256 shade bytes for the first two bases; requires --output-dir')
parser.add_argument('--full-tints', action='store_true', help='All 256 tint bytes for the first two bases; requires --output-dir')
args=parser.parse_args()
if args.full_shades and args.full_tints: parser.error('Choose either full shades or full tints')
full=args.full_shades or args.full_tints
if full and not args.output_dir: parser.error('Full sweeps require --output-dir')
if args.bases:
 import re
 if not all(re.fullmatch(r'[0-9a-fA-F]{6}', value) for value in args.bases):
  parser.error('Each base must contain exactly six hexadecimal digits')
 BASES=[value.upper() for value in args.bases]
if args.bases and not args.output_dir:
 parser.error('--bases requires --output-dir to preserve the original native controls')
KEYS=['accent1','accent2','accent3','accent4','accent5','accent6','dark2','light2']
cases=[];body='<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>'
for base,key in zip(BASES[:2] if full else BASES,KEYS):
 for mode in (['tint' if args.full_tints else 'shade'] if full else ['shade','tint']):
  for value in (range(256) if full else [0,1,64,128,153,191,254,255]):
   i=len(cases);code=f'C{i:03d}';byte=f'{value:02X}';attr='themeShade' if mode=='shade' else 'themeTint'
   cases.append(dict(label=code,base=base,theme=key,mode=mode,value=value))
   p=f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="112233" w:themeColor="{key}" w:{attr}="{byte}"/><w:sz w:val="20"/></w:rPr><w:t>{code}</w:t></w:r></w:p>'
   body+='<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="400" w:hRule="exact"/></w:trPr>'
   for col in range(3):
    prop=f'<w:shd w:val="clear" w:fill="112233" w:themeFill="{key}" w:themeFill{mode.title()}="{byte}"/>' if col==1 else f'<w:tcBorders><w:top w:val="single" w:sz="16" w:color="112233" w:themeColor="{key}" w:{attr}="{byte}"/></w:tcBorders>' if col==2 else ''
    body+=f'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>{prop}</w:tcPr>{p if col==0 else "<w:p/>"}</w:tc>'
   body+='</w:tr>'
body+='</w:tbl><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
colors={'dk1':'000000','lt1':'FFFFFF','dk2':BASES[6],'lt2':BASES[7],**{f'accent{i+1}':c for i,c in enumerate(BASES[:6])},'hlink':'0000FF','folHlink':'800080'}
scheme=''.join(f'<a:{k}><a:srgbClr val="{v}"/></a:{k}>'for k,v in colors.items())
fonts=''.join(f'<a:{k}><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:{k}>'for k in ['majorFont','minorFont'])
solid='<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
theme=f'<a:theme xmlns:a="{A}" name="Original precision controls"><a:themeElements><a:clrScheme name="Controls">{scheme}</a:clrScheme><a:fontScheme name="Arial">{fonts}</a:fontScheme><a:fmtScheme name="Controls"><a:fillStyleLst>{solid*3}</a:fillStyleLst><a:lnStyleLst>{("<a:ln>"+solid+"</a:ln>")*3}</a:lnStyleLst><a:effectStyleLst>{"<a:effectStyle><a:effectLst/></a:effectStyle>"*3}</a:effectStyleLst><a:bgFillStyleLst>{solid*3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
with ZipFile(ROOT/'public/fixtures/empty-table-fragment.docx')as z:parts={n:z.read(n)for n in z.namelist()}
parts['[Content_Types].xml']=parts['[Content_Types].xml'].decode().replace('</Types>','<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>')
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>','<Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>';parts['word/theme/theme1.xml']=theme
out=args.output_dir or ROOT/'tests/fixtures/theme-color-precision'
out.mkdir(parents=True,exist_ok=True)
destination=out/'control.docx' if args.output_dir else ROOT/'public/fixtures/theme-color-precision.docx'
with ZipFile(destination,'w',ZIP_DEFLATED)as z:
 for name,data in parts.items():
  if full:
   info=ZipInfo(name,(2026,9,25,13,0,0));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,data,compress_type=ZIP_DEFLATED)
  else:z.writestr(name,data)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
