"""Original style-linked numbering controls, authored independently of the engine."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from xml.sax.saxutils import escape
import json,argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir',type=Path)
args=parser.parse_args()
O=args.output_dir or Path(__file__).resolve().parents[1]/'tests/fixtures/numbering-style-bindings';O.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/package/2006/relationships';REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
cases=[]
def case(name,**kw):cases.append(dict(name=name,**kw))
for mode in ['unrelated','none','self0','self1']:
 for styleLevel in [None,0,1]:case(mode+' style '+str(styleLevel),links=mode,styleLevel=styleLevel)
case('linked ancestor',links='parent0',parent=True)
case('child overrides ancestor link',links='both',parent=True)
case('linked child inherits numbering',links='self1',parent=True)
case('direct level with unrelated style',links='unrelated',direct={'level':1})
case('direct number with unrelated style',links='unrelated',direct={'num':True})
case('direct number and level with unrelated style',links='unrelated',direct={'num':True,'level':1})
case('empty direct numbering',links='unrelated',direct={})
case('direct level overrides linked style',links='self1',direct={'level':0})
case('direct number overrides linked style',links='self1',direct={'num':True})
case('override links level to style',links='unrelated',override='self1')
case('override removes level link',links='self1',override='none')
case('direct cancellation',links='self0',direct={'num':False})
for styleLevel in [None,0,1]:case('owned unrelated style '+str(styleLevel),links='unrelated',styleLevel=styleLevel,owners=True)
case('direct level with owned unrelated style',links='unrelated',direct={'level':1},owners=True)
case('direct number with owned unrelated style',links='unrelated',direct={'num':True},owners=True)
case('direct number and level with owned unrelated style',links='unrelated',direct={'num':True,'level':1},owners=True)
case('owner uses another instance of same abstract',links='unrelated',owners=True,ownerInstance='same')
case('owner uses another abstract',links='unrelated',owners=True,ownerInstance='different')
case('direct level leaves owned style level',links='unrelated0',direct={'level':1},owners=True)
case('direct level enters owned level',links='unrelated1',direct={'level':1},owners=True)
styles=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:kern w:val="0"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
paras=[];abstracts=[];instances=[]
for i,c in enumerate(cases):
 style=f'C{i}';parent=f'B{i}';num=str(i+1)
 def numPr(value):
  level=value.get('level');number=value.get('num')
  return '<w:numPr>'+ (f'<w:ilvl w:val="{level}"/>' if level is not None else '')+(f'<w:numId w:val="{num if number else 0}"/>' if number is not None else '')+'</w:numPr>'
 ref=numPr({'num':True,'level':c.get('styleLevel')})
 if c.get('parent'):styles+=f'<w:style w:type="paragraph" w:styleId="{parent}"><w:name w:val="Base {i}"/><w:pPr>{ref}</w:pPr></w:style>';ref=''
 styles+=f'<w:style w:type="paragraph" w:styleId="{style}"><w:name w:val="Case {i}"/>'+ (f'<w:basedOn w:val="{parent}"/>' if c.get('parent') else '')+f'<w:pPr>{ref}</w:pPr></w:style>'
 def level(index,links):
  linked=style if links==f'self{index}' or links=='both' and index==1 else parent if (links=='parent0' or links=='both') and index==0 else f'Unrelated{i}_{index}' if links in ['unrelated',f'unrelated{index}'] else None
  return f'<w:lvl w:ilvl="{index}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>'+(f'<w:pStyle w:val="{linked}"/>' if linked else '')+f'<w:lvlText w:val="L{index}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="{720+index*360}"/></w:tabs><w:ind w:left="{720+index*360}" w:hanging="360"/></w:pPr></w:lvl>'
 # Referenced unrelated styles exist, but are outside each paragraph's ancestry.
 for j in range(2):
  owner=f'<w:pPr>{numPr({"num":True,"level":j})}</w:pPr>' if c.get('owners') else ''
  if c.get('ownerInstance'):owner=owner.replace(f'<w:numId w:val="{num}"/>',f'<w:numId w:val="{1000+i}"/>')
  styles+=f'<w:style w:type="paragraph" w:styleId="Unrelated{i}_{j}"><w:name w:val="Unrelated {i} {j}"/>{owner}</w:style>'
 abstracts.append(f'<w:abstractNum w:abstractNumId="{i}"><w:multiLevelType w:val="multilevel"/>'+level(0,c['links'])+level(1,c['links'])+'</w:abstractNum>')
 override=f'<w:lvlOverride w:ilvl="1">{level(1,c["override"])}</w:lvlOverride>' if 'override' in c else ''
 instances.append(f'<w:num w:numId="{num}"><w:abstractNumId w:val="{i}"/>{override}</w:num>')
 if c.get('ownerInstance'):instances.append(f'<w:num w:numId="{1000+i}"><w:abstractNumId w:val="{i if c["ownerInstance"]=="same" else 0}"/></w:num>')
 text=f'N{i:02d} '+c['name'];c.update(index=i,text=text,styleId=style,numId=num)
 direct=numPr(c['direct']) if 'direct' in c else ''
 paras.append(f'<w:p><w:pPr><w:pStyle w:val="{style}"/>{direct}<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="exact"/></w:pPr><w:r><w:t>{escape(text)}</w:t></w:r></w:p>')
styles+='</w:styles>'
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+''.join(f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>'for name,kind in [('document','document.main'),('styles','styles'),('numbering','numbering')])+'</Types>', '_rels/.rels':f'<Relationships xmlns="{R}"><Relationship Id="doc" Type="{REL}officeDocument" Target="word/document.xml"/></Relationships>', 'word/_rels/document.xml.rels':f'<Relationships xmlns="{R}">'+''.join(f'<Relationship Id="{name}" Type="{REL}{name}" Target="{name}.xml"/>'for name in ['styles','numbering'])+'</Relationships>', 'word/styles.xml':styles,'word/numbering.xml':f'<w:numbering xmlns:w="{W}">'+''.join(abstracts+instances)+'</w:numbering>','word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+''.join(paras)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>'}
with ZipFile(O/'control.docx','w') as z:
 for name,data in parts.items():
  info=ZipInfo(name,(2026,9,25,13,0,0));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,data.encode(),compress_type=ZIP_DEFLATED)
(O/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
