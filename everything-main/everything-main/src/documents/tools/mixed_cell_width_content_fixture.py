"""Original noWrap controls varying content, font size and cell margins."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED,ZipInfo
from html import escape
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/mixed-cell-width-content';OUT.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';PKG='http://schemas.openxmlformats.org/package/2006/relationships'
def p(text,br=False):return '<w:p><w:pPr>'+('<w:pageBreakBefore/>'if br else '')+'<w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="'+str(size*2)+'"/></w:rPr><w:t>'+escape(text)+'</w:t></w:r></w:p>'
def cell(text,width,span=1,color='FFFFFF'):
 return '<w:tc><w:tcPr>'+('<w:tcW w:w="0" w:type="auto"/>' if width is None else f'<w:tcW w:w="{width}" w:type="dxa"/>')+(f'<w:gridSpan w:val="{span}"/>'if span>1 else '')+f'<w:shd w:val="clear" w:fill="{color}"/>'+('<w:noWrap/>' if scope=='all' or color!='FFFFFF' else '')+'</w:tcPr>'+p(text)+'</w:tc>'
cases=[];body=''
for scope in ['body','all']:
 for label in ['C0','$24,549']:
  for size in [9,12]:
   for margin in [0,48]:
    layout='autofit';header='footer';pref=2400
    c=dict(noWrapScope=scope,layout=layout,header=header,firstPreference=pref,grid=[3000,1800,600,600],label=label,fontSize=size,margin=margin);cases.append(c)
    body+=p('Case '+str(len(cases)),len(cases)>1)
    body+='<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>'+f'<w:tblLayout w:type="{layout}"/>'+'<w:tblCellMar>'+''.join(f'<w:{s} w:w="{margin}" w:type="dxa"/>'for s in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid>'+''.join(f'<w:gridCol w:w="{v}"/>'for v in c['grid'])+'</w:tblGrid>'
    if header!='none':
     body+='<w:tr>'+cell('Merged heading',6000 if header=='explicit'else None,4)+'</w:tr>'
     body+='<w:tr>'+cell('Left span',4800 if header=='explicit'else None,2)+cell('Right',1200 if header=='explicit'else None,2)+'</w:tr>'
    for row in range(2):body+='<w:tr>'+''.join(cell(chr(65+i)+str(row) if i<2 else label,width,color=['99CCFF','FFCC99','CCFF99','CC99FF'][i])for i,width in enumerate([pref,1440,None,None]))+'</w:tr>'
    if header=='footer':body+='<w:tr>'+cell('Footnote',6000,4)+'</w:tr>'
    body+='</w:tbl>'+p('End')
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+''.join(f'<Override PartName="/word/{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{k}+xml"/>'for n,k in [('document','document.main'),('styles','styles'),('settings','settings')])+'</Types>', '_rels/.rels':f'<Relationships xmlns="{PKG}"><Relationship Id="doc" Type="{REL}officeDocument" Target="word/document.xml"/></Relationships>', 'word/_rels/document.xml.rels':f'<Relationships xmlns="{PKG}">'+''.join(f'<Relationship Id="{n}" Type="{REL}{n}" Target="{n}.xml"/>'for n in ['styles','settings'])+'</Relationships>', 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>', 'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>', 'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'}
with ZipFile(OUT/'control.docx','w') as z:
 for name,data in parts.items():
  info=ZipInfo(name,(2026,9,25,13,0,0));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,data.encode(),compress_type=ZIP_DEFLATED)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
