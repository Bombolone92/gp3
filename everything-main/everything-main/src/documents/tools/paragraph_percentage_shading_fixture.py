"""Original percentage-shading controls with explicit typography and colors."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from xml.etree import ElementTree as E

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/paragraph-percentage-shading'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
patterns = ['pct'+str(n) for n in [5,10,12,15,20,25,30,35,37,40,45,50,55,60,62,65,70,75,80,85,87,90,95]]
cases = []
def paragraph(pattern, color, fill, context='body'):
    label = f'C{len(cases)+1:02}'
    cases.append(dict(label=label, pattern=pattern, color=color, fill=fill, context=context))
    style = '<w:pStyle w:val="ShadeBase"/>' if context == 'inherited-nil' else ''
    return (f'<w:p><w:pPr>{style}<w:shd w:val="{pattern}" w:color="{color}" w:fill="{fill}"/>'
            '<w:spacing w:after="60" w:line="360" w:lineRule="exact"/></w:pPr>'
            '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="008800"/></w:rPr>'
            f'<w:t>{label} {pattern} {color}/{fill} {context}</w:t></w:r></w:p>')

body = ''.join(paragraph(p, '000000', 'FFFFFF') for p in patterns)
body += paragraph('pct5', 'auto', 'auto')
body += paragraph('pct50', 'auto', 'auto')
body += paragraph('pct50', 'F6EDE5', 'auto')
body += paragraph('pct37', 'D12367', '3B6DA1')
body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
cell = ''.join(paragraph(p, color, fill, 'dark-cell') for p,color,fill in [
    ('clear','auto','auto'),('pct5','auto','auto'),('pct50','auto','auto'),
    ('pct50','F6EDE5','auto'),('pct50','auto','EEEEEE'),('pct50','auto','111111'),
    ('pct50','FFFFFF','auto'),('solid','auto','auto'),('nil','FF0000','00FF00')])
body += ('<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
         '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>'
         '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>'
         '<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr>'
         '<w:tcW w:w="9360" w:type="dxa"/><w:shd w:val="clear" w:fill="224466"/>'
         '</w:tcPr>'+cell+'</w:tc></w:tr></w:tbl>')
body += paragraph('nil','auto','auto','inherited-nil')
body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
body += ''.join(paragraph(p,'D12367','3B6DA1','colored') for p in patterns)
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="1440" w:bottom="720" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT / 'public/fixtures/empty-table-fragment.docx') as z:
    parts = {n:z.read(n) for n in z.namelist()}
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:styleId="ShadeBase"><w:name w:val="Shade Base"/><w:pPr><w:shd w:val="clear" w:fill="775533"/></w:pPr></w:style></w:styles>'
types = E.fromstring(parts['[Content_Types].xml'])
E.SubElement(types,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/word/styles.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml')
parts['[Content_Types].xml'] = E.tostring(types)
rels = E.fromstring(parts['word/_rels/document.xml.rels'])
E.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',Id='shadingStyles',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',Target='styles.xml')
parts['word/_rels/document.xml.rels'] = E.tostring(rels)
OUT.mkdir(exist_ok=True)
with ZipFile(OUT/'control.docx', 'w', ZIP_DEFLATED) as z:
    for name,data in parts.items():
        z.writestr(name,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
parts['word/document.xml'] = parts['word/document.xml'].replace('<w:body>', '<w:background w:color="224466"/><w:body>')
with ZipFile(OUT/'dark.docx', 'w', ZIP_DEFLATED) as z:
    for name,data in parts.items():
        z.writestr(name,data)
