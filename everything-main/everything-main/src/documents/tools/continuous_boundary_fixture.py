"""Independent OPC/XML controls for empty continuous-section boundary line height."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
from io import BytesIO
OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/continuous-boundary'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'
fmt='<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>'
def section(columns=1,kind='continuous'):
    return f'<w:sectPr><w:type w:val="{kind}"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:num="{columns}" w:space="720"/></w:sectPr>'
def p(text='',height=12,sect='',before=0,after=0,decoration=''):
    run=f'<w:r><w:rPr>{fmt}</w:rPr><w:t>{text}</w:t></w:r>' if text else ''
    return f'<w:p><w:pPr>{decoration}<w:spacing w:before="{before*20}" w:after="{after*20}" w:line="{height*20}" w:lineRule="exact"/><w:rPr>{fmt}</w:rPr>{sect}</w:pPr>{run}</w:p>'
def table(rows=1):
    return '<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid>'+''.join('<w:tr><w:trPr><w:trHeight w:val="'+str(720 if rows==1 else 240)+'" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>'+p('TABLE' if rows==1 else f'ROW {i}')+'</w:tc></w:tr>' for i in range(rows))+'</w:tbl>'
def build():
    OUT.mkdir(parents=True,exist_ok=True)
    cases=[]
    for before,after,has_table,kind in [(1,1,False,'continuous'),(1,2,False,'continuous'),(2,1,False,'continuous'),(1,1,True,'continuous'),(1,2,True,'continuous'),(2,1,True,'continuous'),(1,1,False,'nextPage')]:
        for height in [12,24]:
            name=f'{"table" if has_table else "text"}-{before}-{after}-{kind}-{height}'
            cases.append(dict(name=name,before=before,after=after,table=has_table,kind=kind,height=height))
    for height in [12,24]:
        cases.append(dict(name=f'empty-section-{height}',before=1,after=1,table=False,kind='continuous',height=height,emptySection=True))
    cases.extend([dict(name='table-spacing',before=1,after=1,table=True,kind='continuous',height=12,spaceBefore=18,spaceAfter=6),dict(name='text-spacing',before=1,after=1,table=False,kind='continuous',height=12,spaceBefore=18,spaceAfter=6),dict(name='table-decoration',before=1,after=1,table=True,kind='continuous',height=12,decoration=True)])
    for rows in [2,4,10]:
        for before in [1,2]:
            for height in [12,24]:cases.append(dict(name=f'rows-{rows}-{before}-{height}',before=before,after=1,table=True,kind='continuous',height=height,rows=rows))
    for height in [12,24]:
        cases.extend([dict(name=f'legacy-table-{height}',before=1,after=1,table=True,kind='continuous',height=height,compatibility=12),dict(name=f'legacy-rows-{height}',before=2,after=1,table=True,kind='continuous',height=height,rows=10,compatibility=12),dict(name=f'legacy-empty-{height}',before=1,after=1,table=False,kind='continuous',height=height,emptySection=True,compatibility=12)])
        cases.append(dict(name=f'compat14-table-{height}',before=1,after=1,table=True,kind='continuous',height=height,compatibility=14))
    for case in cases:
        name=case['name'];before=case['before'];after=case['after'];has_table=case['table'];kind=case['kind'];height=case['height']
        decoration='<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="0" w:color="FF0000"/></w:pBdr><w:shd w:val="clear" w:fill="FFFF00"/>' if case.get('decoration') else ''
        body=p('BEFORE')+(table(case.get('rows',1)) if has_table else p('SECOND'))+p(height=12 if case.get('emptySection') else height,sect=section(before,'nextPage'),before=case.get('spaceBefore',0),after=case.get('spaceAfter',0),decoration=decoration)
        if case.get('emptySection'):body+=p(height=height,sect=section())
        body+=p('AFTER')+section(after,kind)
        parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
         '_rels/.rels':f'<Relationships xmlns="{R}"><Relationship Id="rDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
         'word/_rels/document.xml.rels':f'<Relationships xmlns="{R}"><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
         'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{case.get("compatibility",15)}"/></w:compat></w:settings>',
         'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'}
        buffer=BytesIO()
        with ZipFile(buffer,'w') as z:
            for path,data in parts.items():
                info=ZipInfo(path,(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
        path=OUT/(name+'.docx');data=buffer.getvalue()
        if not path.exists() or path.read_bytes()!=data:path.write_bytes(data)
    (OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
if __name__=='__main__':build()
