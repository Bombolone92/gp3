"""Independent OOXML controls for oversized body lines; no copied template content."""
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/oversized-body-lines'
ROOT.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def para(text,size=12,extra='',run_extra=''):
 before = extra if extra == '<w:pageBreakBefore/>' else ''
 extra = '' if before else extra
 return f'<w:p><w:pPr>{before}<w:spacing w:before="0" w:after="0"/>{extra}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="D02030"/><w:sz w:val="{size*2}"/>{run_extra}</w:rPr><w:t>{escape(text)}</w:t></w:r></w:p>'
cases={
 'fresh':para('A',650)+para('After'),
 'preceded':para('Before')+para('A',650)+para('After'),
 'consecutive':para('A',650)+para('B',650)+para('After'),
 'wrapped':para('AB',650)+para('After'),
 'explicit-break':para('A',650)+para('B',650,'<w:pageBreakBefore/>')+para('After'),
 'large-spacing':para('A',400,'<w:spacing w:line="720" w:lineRule="auto"/>')+para('After'),
}
# Replace the default spacing declaration for the intentionally tall line case.
cases['large-spacing']=cases['large-spacing'].replace('<w:spacing w:before="0" w:after="0"/><w:spacing w:line="720" w:lineRule="auto"/>','<w:spacing w:before="0" w:after="0" w:line="720" w:lineRule="auto"/>')
for name,body in cases.items():
 if len(sys.argv)>1 and name not in sys.argv[1:]:continue
 parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
 'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>'}
 with ZipFile(ROOT/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for path,xml in parts.items():z.writestr(path,'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+xml)
 print(name)
