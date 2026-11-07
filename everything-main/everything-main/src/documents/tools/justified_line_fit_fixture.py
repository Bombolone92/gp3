"""Original paired left/justified line fitting controls in installed fonts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
TEXT='Our team will review the revised project schedule and prepare a clear summary for the next meeting. Please keep the final notes beside the working draft.'
def p(text,font,size,align='left',width=468,line=300):
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="'+str(line)+'" w:lineRule="exact"/><w:ind w:right="'+str(round((468-width)*20))+'"/><w:jc w:val="'+align+'"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="'+font+'" w:hAnsi="'+font+'"/><w:color w:val="000000"/><w:sz w:val="'+str(size*2)+'"/></w:rPr><w:t>'+escape(text)+'</w:t></w:r></w:p>'
body=''
for font in ['Calibri','Arial']:
    for width in [360,365,370,375]:
        for align in ['left','both']:
            body+=p(f'{font}, {width}pt, {align}','Arial',9,line=240)+p(TEXT,font,11,align,width)
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="1440" w:bottom="720" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT/'public/fixtures/numeric-page-fields.docx') as z:
    parts={n:z.read(n) for n in ['[Content_Types].xml','_rels/.rels','word/styles.xml','word/_rels/document.xml.rels']}
parts['word/footer.xml']=f'<w:ftr xmlns:w="{W}"><w:p/></w:ftr>'.encode()
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(ROOT/'public/fixtures/justified-line-fit.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
