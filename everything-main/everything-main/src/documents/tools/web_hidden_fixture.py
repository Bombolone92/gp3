"""Original paginated-view controls for webHidden."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

def run(text,props=''):
 return '<w:r>'+('<w:rPr>'+props+'</w:rPr>' if props else '')+'<w:t>'+escape(text)+'</w:t></w:r>'
def para(text,rpr='',style=''):
 return '<w:p><w:pPr>'+('<w:pStyle w:val="'+style+'"/>' if style else '')+'<w:spacing w:before="0" w:after="0" w:line="320" w:lineRule="exact"/></w:pPr>'+run(text,rpr)+'</w:p>'
body=para('Plain visible text')+para('Direct web hidden text','<w:webHidden/>')+para('Explicit web visible text','<w:webHidden w:val="false"/>')+para('Paragraph inherited web hidden','','HiddenParagraph')+para('Character inherited web hidden','<w:rStyle w:val="HiddenCharacter"/>')+para('Character reset web visible','<w:rStyle w:val="VisibleCharacter"/>','HiddenParagraph')+para('Direct reset web visible','<w:webHidden w:val="0"/>','HiddenParagraph')
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
footer=''

parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join('<Override PartName="/word/'+n+'.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+t+'+xml"/>' for n,t in [('document','document.main'),('styles','styles'),('settings','settings')])+'</Types>',
    '_rels/.rels': '<Relationships xmlns="'+REL+'"><Relationship Id="main" Type="'+R+'/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="'+REL+'">'+''.join('<Relationship Id="'+n+'" Type="'+R+'/'+n+'" Target="'+n+'.xml"/>' for n in ['styles','settings'])+'</Relationships>',
    'word/document.xml': '<w:document xmlns:w="'+W+'" xmlns:r="'+R+'"><w:body>'+body+'</w:body></w:document>',
    'word/footer.xml': '<w:ftr xmlns:w="'+W+'">'+footer+'</w:ftr>',
    'word/styles.xml': '<w:styles xmlns:w="'+W+'"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    'word/settings.xml': '<w:settings xmlns:w="'+W+'"><w:updateFields w:val="true"/></w:settings>',
}

parts.pop('word/footer.xml')
parts['word/styles.xml']=parts['word/styles.xml'].replace('</w:styles>','<w:style w:type="paragraph" w:styleId="HiddenParagraph"><w:name w:val="Hidden Paragraph"/><w:rPr><w:webHidden/></w:rPr></w:style><w:style w:type="character" w:styleId="HiddenCharacter"><w:name w:val="Hidden Character"/><w:rPr><w:webHidden/></w:rPr></w:style><w:style w:type="character" w:styleId="VisibleCharacter"><w:name w:val="Visible Character"/><w:rPr><w:webHidden w:val="0"/></w:rPr></w:style></w:styles>')
with ZipFile(ROOT/'public/fixtures/web-hidden.docx','w',ZIP_DEFLATED) as z:
 for name,text in parts.items():z.writestr(name,text.encode())
