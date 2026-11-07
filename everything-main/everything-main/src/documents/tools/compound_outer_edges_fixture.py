"""Original equal-side table controls separating border allocation from paint."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
import json

repo=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def paragraph(text, new_page=False):
    return '<w:p><w:pPr>'+('<w:pageBreakBefore/>' if new_page else '')+'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>'+text+'</w:t></w:r></w:p>'

for mode in [12,15]:
    folder=repo/f'tests/fixtures/compound-outer-edges/mode{mode}'
    folder.mkdir(parents=True,exist_ok=True)
    with ZipFile(repo/'tests/fixtures/docpart-object/control.docx') as z: parts={n:z.read(n) for n in z.namelist()}
    cases=[dict(style=s,size=size,rule=rule) for s in ['thinThickSmallGap','thickThinSmallGap','thinThickMediumGap','thickThinMediumGap'] for size in [0,11,24,36] for rule in ['auto','exact']]
    body=''
    for i,c in enumerate(cases):
        body+=paragraph(f'Control {i+1}: {c["style"]} {c["size"]} {c["rule"]}',bool(i))
        borders=''.join(f'<w:{side} w:val="{c["style"]}" w:sz="{c["size"]}" w:color="{color}"/>' for side,color in [('top','CC0000'),('left','008800'),('bottom','0000CC'),('right','AA00AA')])
        body+='<w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/><w:tblBorders>'+borders+'</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4800"/></w:tblGrid><w:tr>'
        if c['rule']=='exact':body+='<w:trPr><w:trHeight w:val="960" w:hRule="exact"/></w:trPr>'
        body+='<w:tc><w:tcPr><w:tcW w:w="4800" w:type="dxa"/></w:tcPr>'+paragraph(f'Cell {i+1}')+'</w:tc></w:tr></w:tbl>'+paragraph(f'After {i+1}')
    body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    parts['word/document.xml']=(f'<w:document xmlns:w="{W}"><w:body>'+body+'</w:body></w:document>').encode()
    parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'.encode()
    rels=E.fromstring(parts.get('word/_rels/document.xml.rels',b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'))
    E.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',Id='settingsOuterEdges',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',Target='settings.xml')
    parts['word/_rels/document.xml.rels']=E.tostring(rels)
    ct=E.fromstring(parts['[Content_Types].xml']);E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/word/settings.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml');parts['[Content_Types].xml']=E.tostring(ct)
    with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
        for n,data in parts.items():z.writestr(n,data)
    (folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
    print(folder/'control.docx')
