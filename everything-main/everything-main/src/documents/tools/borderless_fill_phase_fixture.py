"""Original full-twip borderless shading sweep, authored directly as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse,json,hashlib

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'

def generate(folder):
    p='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>'
    body=[];cases=[]
    for family in range(4):
        for phase in range(15):
            i=len(cases);x=360+750*(i%6)+phase;y=360+330*(i//6)+(phase*7)%15
            widths=[[593],[600],[607],[293,307]][family];height=[113,120,127,120][family]
            colors=['FF0000'] if family!=3 else ['FF0000','0000FF']
            cells=''.join(f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="{color}"/></w:tcPr>{p}</w:tc>' for width,color in zip(widths,colors))
            borders=''.join(f'<w:{side} w:val="nil"/>' for side in ['top','left','bottom','right','insideH','insideV'])
            margins=''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])
            grid=''.join(f'<w:gridCol w:w="{width}"/>' for width in widths)
            body.append(f'<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="{x}" w:tblpY="{y}"/><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid>{grid}</w:tblGrid><w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="exact"/></w:trPr>{cells}</w:tr></w:tbl>{p}')
            cases.append(dict(id=i+1,family=family,phaseTwips=phase,xTwips=x,yTwips=y,widthsTwips=widths,heightTwips=height,colors=colors))
    body.append('<w:sectPr><w:pgSz w:w="5760" w:h="4320"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    parts={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
      '_rels/.rels':f'<Relationships xmlns="{R}"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels':f'<Relationships xmlns="{R}"><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
      'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>',
      'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:zoom w:percent="100"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'}
    folder.mkdir(parents=True,exist_ok=True)
    with ZipFile(folder/'control.docx','w') as archive:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;archive.writestr(info,data)
    (folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
    print(hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest())

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);generate(parser.parse_args().output)
