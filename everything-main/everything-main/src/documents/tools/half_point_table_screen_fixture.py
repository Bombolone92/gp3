"""Original connected half-point table rules; deterministic manual OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse, json, hashlib
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'

def generate(folder):
    body=[];cases=[]
    paragraph='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr></w:r></w:p>'
    for row,phase in enumerate([0,4,8,12]):
        for col,(color,theme,fill) in enumerate([('auto',None,'FFFFFF'),('FFC000','accent4','FFFFFF'),('FFFFFF','background1','4472C4')]):
            x=360+1800*col+phase;y=360+930*row+phase
            attr=f' w:themeColor="{theme}"' if theme else ''
            borders=''.join(f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="{color}"{attr}/>' for side in ['top','left','bottom','right','insideH','insideV'])
            margins=''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])
            cell=f'<w:tc><w:tcPr><w:tcW w:w="720" w:type="dxa"/><w:shd w:val="clear" w:fill="{fill}"/></w:tcPr>{paragraph}</w:tc>'
            rows=''.join(f'<w:tr><w:trPr><w:trHeight w:val="360" w:hRule="exact"/></w:trPr>{cell}{cell}</w:tr>' for _ in range(2))
            body.append(f'<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="{x}" w:tblpY="{y}"/><w:tblW w:w="1440" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="720"/><w:gridCol w:w="720"/></w:tblGrid>{rows}</w:tbl>{paragraph}')
            cases.append(dict(id=len(cases)+1,xTwips=x,yTwips=y,widthTwips=1440,rowHeightTwips=360,rows=2,columns=2,borderSize=4,color=color,theme=theme,fill=fill))
    body.append('<w:sectPr><w:pgSz w:w="5760" w:h="4320"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    theme='''<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Original"><a:themeElements><a:clrScheme name="Original">'''+''.join(f'<a:{name}><a:srgbClr val="{color}"/></a:{name}>' for name,color in [('dk1','000000'),('lt1','FFFFFF'),('dk2','44546A'),('lt2','E7E6E6'),('accent1','4472C4'),('accent2','ED7D31'),('accent3','A5A5A5'),('accent4','FFC000'),('accent5','5B9BD5'),('accent6','70AD47'),('hlink','0563C1'),('folHlink','954F72')])+'''</a:clrScheme><a:fontScheme name="Original"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Original"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>'''
    solid='<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    fmt=f'<a:fmtScheme name="Original"><a:fillStyleLst>{solid*3}</a:fillStyleLst><a:lnStyleLst>'+''.join(f'<a:ln w="{width}">{solid}<a:prstDash val="solid"/></a:ln>' for width in [6350,12700,19050])+f'</a:lnStyleLst><a:effectStyleLst>{"<a:effectStyle><a:effectLst/></a:effectStyle>"*3}</a:effectStyleLst><a:bgFillStyleLst>{solid*3}</a:bgFillStyleLst></a:fmtScheme>'
    theme=theme.replace('<a:fmtScheme name="Original"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>',fmt)
    parts={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>',
      '_rels/.rels':f'<Relationships xmlns="{R}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels':f'<Relationships xmlns="{R}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>',
      'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>',
      'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:zoom w:percent="100"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
      'word/theme/theme1.xml':theme}
    folder.mkdir(parents=True,exist_ok=True)
    with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
    (folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
    print(hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest())

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);generate(parser.parse_args().output)
