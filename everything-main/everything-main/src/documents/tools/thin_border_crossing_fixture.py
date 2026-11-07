"""Original unequal/equal thin crossing controls, manually authored OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse, hashlib, json

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'

def generate(folder):
    body=[];cases=[]
    paragraph='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>'
    for row,phase in enumerate([0,8,9,12]):
        for col,(horizontal,vertical) in enumerate([(2,4),(4,2),(2,2)]):
            x=360+1800*col+phase;y=360+930*row+phase
            borders=''.join(f'<w:{side} w:val="single" w:sz="{horizontal if side in ["top","bottom","insideH"] else vertical}" w:color="{"0000FF" if side in ["top","bottom","insideH"] else "FF0000"}"/>' for side in ['top','left','bottom','right','insideH','insideV'])
            margins=''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])
            cell=f'<w:tc><w:tcPr><w:tcW w:w="720" w:type="dxa"/></w:tcPr>{paragraph}</w:tc>'
            rows=''.join(f'<w:tr><w:trPr><w:trHeight w:val="360" w:hRule="exact"/></w:trPr>{cell}{cell}</w:tr>' for _ in range(2))
            body.append(f'<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="{x}" w:tblpY="{y}"/><w:tblW w:w="1440" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="720"/><w:gridCol w:w="720"/></w:tblGrid>{rows}</w:tbl>{paragraph}')
            cases.append(dict(id=len(cases)+1,xTwips=x,yTwips=y,widthTwips=1440,rowHeightTwips=360,horizontalSize=horizontal,verticalSize=vertical,horizontalColor='0000FF',verticalColor='FF0000'))
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
