"""Original paired WML/DrawingML lightness controls; no corpus XML/artwork."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED,ZipInfo
import json,argparse
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=Path,default=ROOT/'tests/fixtures/theme-domain-colors')
args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
bases=['4F81BD','C0504D','7F8080','202121']
values=[8,14,85,86,128,191,228,255]
cases=[]
for i,base in enumerate(bases):
    for value in values:
        cases.append(dict(label=f'C{len(cases):03}',base=base,key=f'accent{i+1}',shade=value,
                          floor=value*100000//255,ceil=(value*100000+254)//255))
def drawing(index,color,key,amount):
    tag='schemeClr' if key else 'srgbClr'
    return f'''<w:r><w:drawing><wp:inline><wp:extent cx="508000" cy="203200"/><wp:docPr id="{index}" name="Original swatch {index}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="{WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="508000" cy="203200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:{tag} val="{color}"><a:lumMod val="{amount}"/></a:{tag}></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'''
body=''
for page in range(2):
    body+=f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if page else ""}<w:spacing w:after="0"/></w:pPr><w:r><w:t>Cross-domain color controls {page+1}</w:t></w:r></w:p>'
    body+='<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid>'+('<w:gridCol w:w="1440"/>'*5)+'</w:tblGrid>'
    for row,case in enumerate(cases[page*16:(page+1)*16]):
        body+='<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="480" w:hRule="exact"/></w:trPr>'
        for col in range(5):
            prop=f'<w:shd w:val="clear" w:fill="112233" w:themeFill="{case["key"]}" w:themeFillShade="{case["shade"]:02X}"/>' if col==1 else ''
            body+=f'<w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/>{prop}</w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/></w:pPr>'
            if col==0:body+=f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/></w:rPr><w:t>{case["label"]}</w:t></w:r>'
            elif col>1:
                body+=drawing((page*16+row)*3+col-1,case['key'] if col==3 else case['base'],col==3,case['ceil'] if col==4 else case['floor'])
            body+='</w:p></w:tc>'
        body+='</w:tr>'
    body+='</w:tbl><w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT/'public/fixtures/shape-theme.docx') as z:
    parts={name:z.read(name) for name in z.namelist()}
    theme=parts['word/theme/probe.xml'].decode()
from lxml import etree as E
root=E.fromstring(theme)
for i,base in enumerate(bases):root.find(f'.//{{{A}}}accent{i+1}/{{{A}}}srgbClr').set('val',base)
parts['word/theme/probe.xml']=E.tostring(root)
parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{WPS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="wps"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(args.output/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():
        info=ZipInfo(name,(2026,10,1,12,0,0));info.create_system=0;info.external_attr=0o600<<16
        z.writestr(info,data,compress_type=ZIP_DEFLATED)
(args.output/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print(f'Authored {len(cases)} rows / {len(cases)*4} native color comparisons')
