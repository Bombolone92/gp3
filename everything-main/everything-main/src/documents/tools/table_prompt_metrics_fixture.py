"""Original OOXML isolation controls for large bold labels in table cells."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import argparse,json
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def generate(root):
 root.mkdir(parents=True,exist_ok=True);cases=[];body=[]
 for index,(formatting,control) in enumerate((f,c) for f in ['style','direct'] for c in ['plain','temporary','persistent']):
  case={'page':index+1,'formatting':formatting,'control':control};cases.append(case)
  body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if index else ""}</w:pPr><w:r><w:t>Case {index+1}</w:t></w:r></w:p>')
  ppr='<w:pStyle w:val="Label"/>' if formatting=='style' else '<w:jc w:val="center"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr>'
  rpr='' if formatting=='style' else '<w:rPr><w:b/><w:sz w:val="36"/></w:rPr>'
  run=f'<w:r>{rpr}<w:t>W:</w:t></w:r>'
  if control!='plain':run=f'<w:sdt><w:sdtPr><w:id w:val="{100+index}"/>{"<w:temporary/>" if control=="temporary" else ""}<w:showingPlcHdr/></w:sdtPr><w:sdtContent>{run}</w:sdtContent></w:sdt>'
  paragraph=f'<w:p><w:pPr>{ppr}</w:pPr>{run}</w:p>'
  cellpr='<w:tcPr><w:tcW w:w="900" w:type="dxa"/></w:tcPr>'
  body.append('<w:tbl><w:tblPr><w:tblW w:w="6300" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/><w:insideV w:val="single" w:sz="8"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="900"/><w:gridCol w:w="5400"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="720" w:hRule="exact"/></w:trPr><w:tc>'+cellpr+paragraph+'</w:tc><w:tc><w:tcPr><w:tcW w:w="5400" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>')
  body.append('<w:p/>')
 parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
 'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="Label"><w:name w:val="Label"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style></w:styles>',
 'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+''.join(body)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>'}
 with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
  for path,xml in parts.items():
   info=ZipInfo(path,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+xml)
 (root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n');print(root/'control.docx')
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/table-prompt-metrics');generate(parser.parse_args().output)
