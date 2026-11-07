"""Independent XML controls for first-line indentation after leading breaks."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import sys
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
root=Path(__file__).resolve().parents[1]/'tests/fixtures/leading-break-indent'
root.mkdir(exist_ok=True)
page='<w:br w:type="page"/>'
cases={'page':page,'column':'<w:br w:type="column"/>','text':'<w:t>Before</w:t>'+page,
       'space':'<w:t xml:space="preserve"> </w:t>'+page,'tab':'<w:tab/>'+page,
       'line':'<w:br/>'+page,'double':page+page,'positive':page,'numbered':page}
sample='START Alpha beta gamma delta epsilon zeta eta theta. '+('More words carry this paragraph onto its next line. '*4)
for name,prefix in cases.items():
    if len(sys.argv)>1 and name!=sys.argv[1]:continue
    indent='w:left="720" '+('w:firstLine="360"' if name=='positive' else 'w:hanging="720"')
    body=f'<w:p><w:r><w:t>{name} indentation control</w:t></w:r></w:p><w:p><w:pPr><w:ind {indent}/></w:pPr><w:r>{prefix}<w:t xml:space="preserve">{escape(sample)}</w:t></w:r></w:p>'
    parts={
        'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
        'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
        '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels':f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/></Relationships>',
        '[Content_Types].xml':f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/></Types>',
    }
    if name=='numbered':
        parts['word/document.xml']=parts['word/document.xml'].replace('<w:pPr><w:ind','<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind')
        parts['word/numbering.xml']=f'<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="720"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
        parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="numbering" Type="{R}/numbering" Target="numbering.xml"/></Relationships>')
        parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/numbering.xml" ContentType="{CT}numbering+xml"/></Types>')
    with ZipFile(root/(name+'.docx'),'w',ZIP_DEFLATED) as archive:
        for part,data in parts.items():archive.writestr(part,data)
    print(name)
