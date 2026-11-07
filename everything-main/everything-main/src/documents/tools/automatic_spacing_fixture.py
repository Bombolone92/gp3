"""Original OOXML controls for automatic paragraph spacing and compatibility."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from canvas_first_section_fixture import parts as shell,W
parts=dict(shell)
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
def para(text,size=10,auto=None,page=False):
 spacing=f'w:line="{(size+2)*20}" w:lineRule="exact" w:before="0" w:after="0"' if auto is None else f'w:line="{(size+2)*20}" w:lineRule="exact" w:before="100" w:after="100" w:beforeLines="200" w:afterLines="300" w:beforeAutospacing="{auto}" w:afterAutospacing="{auto}"'
 return f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if page else ""}<w:spacing {spacing}/></w:pPr><w:r><w:rPr><w:sz w:val="{size*2}"/></w:rPr><w:t>{text}</w:t></w:r></w:p>'
body=''
for i,(size,auto) in enumerate([(10,1),(20,1),(10,0),(20,0)]):
 label=f'S{size}Auto{auto}'
 body+=para(label,10,page=i>0)+para(label+'A',size)+para(label+'B',size,auto)+para(label+'C',size)
 body+='<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>'
 body+=''.join(para(label+'T'+str(j),size,auto) for j in range(3))+'</w:tc></w:tr></w:tbl>'+para(label+'End',size)
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'

OUT=Path(__file__).resolve().parents[1]/'public/fixtures'
def write(name, package):
 with ZipFile(OUT/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in package.items():z.writestr(n,b)
write('automatic-spacing-legacy',parts)
base={n:b.encode() if isinstance(b,str) else b for n,b in parts.items()}
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
base['word/_rels/document.xml.rels']=base['word/_rels/document.xml.rels'].replace(b'</Relationships>',f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>'.encode())
base['[Content_Types].xml']=base['[Content_Types].xml'].replace(b'</Types>',b'<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
base['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
write('automatic-spacing-modern',base)
fixed=dict(base);fixed['word/settings.xml']=base['word/settings.xml'].replace(b'<w:compat>',b'<w:compat><w:doNotUseHTMLParagraphAutoSpacing/>')
write('automatic-spacing-fixed',fixed)

def p(label, attrs='', br=False):
 return f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if br else ""}<w:spacing w:line="240" w:lineRule="exact" {attrs}/></w:pPr><w:r><w:t>{label}</w:t></w:r></w:p>'
auto='w:beforeAutospacing="1" w:afterAutospacing="1"'
body=''
for i,(name,attrs) in enumerate([('Auto',auto),('Point',auto+' w:before="100" w:after="200"'),('Zero',auto+' w:before="0" w:after="0"'),('Plain','w:before="100" w:after="200"')]):
 body+=p(name+'First',attrs,i>0)+p(name+'Second',attrs)+p('',attrs)+p(name+'AfterEmpty','w:before="0" w:after="0"')
 body+='<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>'
 body+=p(name+'T0',attrs)+p(name+'T1',attrs)+p(name+'T2',attrs)+'</w:tc></w:tr></w:tbl>'+p(name+'End','w:before="0" w:after="0"')
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
for mode in ['modern','fixed']:
 parts=dict(base);parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
 if mode=='fixed':parts['word/settings.xml']=parts['word/settings.xml'].replace(b'<w:compat>',b'<w:compat><w:doNotUseHTMLParagraphAutoSpacing/>')
 write('automatic-spacing-boundaries-'+mode,parts)

R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
base['word/_rels/document.xml.rels']=base['word/_rels/document.xml.rels'].replace(b'</Relationships>',f'<Relationship Id="numbers" Type="{R}/numbering" Target="numbering.xml"/></Relationships>'.encode())
base['[Content_Types].xml']=base['[Content_Types].xml'].replace(b'</Types>',b'<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>')
base['word/numbering.xml']=f'<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>'+''.join(f'<w:lvl w:ilvl="{i}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%{i+1}."/><w:pPr><w:ind w:left="{720*(i+1)}" w:hanging="360"/></w:pPr></w:lvl>' for i in range(2))+'</w:abstractNum>'+''.join(f'<w:num w:numId="{i}"><w:abstractNumId w:val="0"/></w:num>' for i in [1,2])+'</w:numbering>'
body=p('Before','w:before="0" w:after="0"')
for label,num,level in [('One',1,0),('Two',1,0),('Nested',1,1),('Three',1,0),('NewList',2,0)]:
 body+=p(label,auto).replace('<w:pPr>',f'<w:pPr><w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{num}"/></w:numPr>')
body+=p('After','w:before="0" w:after="0"')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
base['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
write('automatic-spacing-lists',base)

# Distinct list definitions retain the 14pt gap; adjacent items in the same
# definition suppress automatic spacing, including different nesting levels.
from lxml import etree as E
import copy
base={n:b.encode() if isinstance(b,str) else b for n,b in base.items()}
ns={'w':W};numbers=E.fromstring(base['word/numbering.xml'])
for i,fmt in [(1,'decimal'),(2,'bullet')]:
 abstract=copy.deepcopy(numbers[0]);abstract.set('{'+W+'}abstractNumId',str(i))
 for node in abstract.findall('.//w:numFmt',ns):node.set('{'+W+'}val',fmt)
 if fmt=='bullet':
  for node in abstract.findall('.//w:lvlText',ns):node.set('{'+W+'}val','•')
 numbers.insert(i,abstract)
 number=E.SubElement(numbers,'{'+W+'}num');number.set('{'+W+'}numId',str(i+2))
 node=E.SubElement(number,'{'+W+'}abstractNumId');node.set('{'+W+'}val',str(i))
document=E.fromstring(base['word/document.xml']);body=document.find('w:body',ns);template=body[5]
for i,(label,num) in enumerate([('DistinctDecimal',3),('DistinctBullet',4),('BulletSecond',4)]):
 paragraph=copy.deepcopy(template);paragraph.find('.//w:t',ns).text=label
 paragraph.find('.//w:numId',ns).set('{'+W+'}val',str(num));body.insert(6+i,paragraph)
base['word/document.xml']=E.tostring(document);base['word/numbering.xml']=E.tostring(numbers)
write('automatic-spacing-list-boundaries',base)
