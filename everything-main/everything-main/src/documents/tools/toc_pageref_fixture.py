"""Original nested, multi-paragraph TOC/PAGEREF import control; no corpus assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import sys

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
HYPERLINK_STYLE = '--hyperlink-style' in sys.argv
FORMATTED = '--formatted' in sys.argv or HYPERLINK_STYLE

def run(text):
    properties = ''
    if FORMATTED and text in ['First topic', 'Second topic', 'Third topic']:
        properties = '<w:rPr><w:rStyle w:val="Entry"/></w:rPr>'
        if HYPERLINK_STYLE and text != 'Third topic':
            direct = '<w:color w:val="C02030"/><w:u w:val="double"/>' if text == 'Second topic' else ''
            properties = '<w:rPr><w:rStyle w:val="LinkStyle"/>'+direct+'</w:rPr>'
    elif FORMATTED and text in ['2', '3', '4']:
        properties = '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:b/><w:color w:val="008040"/><w:sz w:val="28"/></w:rPr>'
    return '<w:r>'+properties+'<w:t xml:space="preserve">'+escape(text)+'</w:t></w:r>'

def char(kind):
    return '<w:r><w:fldChar w:fldCharType="'+kind+'"/></w:r>'

def instruction(text):
    return '<w:r><w:instrText xml:space="preserve">'+escape(text)+'</w:instrText></w:r>'

def field(text, result):
    begin=char('begin').replace('w:fldCharType="begin"','w:fldCharType="begin" w:fldLock="true"') if FORMATTED else char('begin')
    return begin+instruction(text)+char('separate')+run(result)+char('end')

def para(text, properties=''):
    return '<w:p><w:pPr>'+properties+'<w:spacing w:after="120" w:line="320" w:lineRule="exact"/></w:pPr>'+text+'</w:p>'

body=para(run('Nested table of contents control'))
titles=['First topic','Second topic','Third topic']
for i,title in enumerate(titles):
    content=(char('begin')+instruction(' TOC \\o "1-3" \\h \\z \\u ')+char('separate')) if i==0 else ''
    content+='<w:hyperlink w:anchor="Topic'+str(i+1)+'">'+run(title)+'<w:r><w:tab/></w:r>'+field(' PAGEREF Topic'+str(i+1)+' \\h ',str(i+2))+'</w:hyperlink>'
    if i==2: content+=char('end')
    body+=para(content,'<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8640"/></w:tabs>')
body+=para(run('After the table of contents.'))
body+=para(run('Independent reference: ')+field(' PAGEREF Topic2 \\h ','3'))
for i,title in enumerate(titles):
    body+=para('<w:bookmarkStart w:id="'+str(i)+'" w:name="Topic'+str(i+1)+'"/>'+run(title)+'<w:bookmarkEnd w:id="'+str(i)+'"/>','<w:pStyle w:val="Heading1"/><w:pageBreakBefore/>')
    body+=para(run('This is original test text for '+title.lower()+'.'))
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join('<Override PartName="/word/'+name+'.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+kind+'+xml"/>' for name,kind in [('document','document.main'),('styles','styles')])+'</Types>',
    '_rels/.rels':'<Relationships xmlns="'+REL+'"><Relationship Id="main" Type="'+R+'/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels':'<Relationships xmlns="'+REL+'"><Relationship Id="styles" Type="'+R+'/styles" Target="styles.xml"/></Relationships>',
    'word/document.xml':'<w:document xmlns:w="'+W+'" xmlns:r="'+R+'"><w:body>'+body+'</w:body></w:document>',
    'word/styles.xml':'<w:styles xmlns:w="'+W+'"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>',
}
if FORMATTED:
    parts['word/styles.xml']=parts['word/styles.xml'].replace('</w:styles>','<w:style w:type="character" w:styleId="Entry"><w:name w:val="Entry"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:i/><w:color w:val="7030A0"/><w:sz w:val="32"/></w:rPr></w:style></w:styles>')
if HYPERLINK_STYLE:
    parts['word/styles.xml']=parts['word/styles.xml'].replace('</w:styles>','<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style><w:style w:type="character" w:styleId="LinkStyle"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:i/><w:color w:val="2050C0"/><w:u w:val="single"/><w:sz w:val="32"/></w:rPr></w:style></w:styles>')
name = 'toc-hyperlink-style' if HYPERLINK_STYLE else 'toc-pageref-formatting' if FORMATTED else 'toc-pageref'
with ZipFile(ROOT/('public/fixtures/'+name+'.docx'),'w',ZIP_DEFLATED) as archive:
    for name,text in parts.items(): archive.writestr(name,text.encode())
