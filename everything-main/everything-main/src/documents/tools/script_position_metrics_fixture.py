"""Original font-metric controls derived from the repository's OFL Bebas Neue.
Only names, selected OS/2/hhea metrics, checksums and DSIG removal differ.
"""
from pathlib import Path
import struct,json
ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/script-position-metrics';ROOT.mkdir(exist_ok=True)
SOURCE=Path(__file__).resolve().parents[1]/'public/fonts/BebasNeue-Regular.ttf'
original=SOURCE.read_bytes()
def checksum(b):
 b=b+b'\0'*((-len(b))%4);return sum(struct.unpack('>'+str(len(b)//4)+'I',b))&0xffffffff
def build(family,changes,output=None):
 tables={}
 for i in range(struct.unpack_from('>H',original,4)[0]):
  tag=original[12+i*16:16+i*16];off,length=struct.unpack_from('>II',original,20+i*16);tables[tag]=bytearray(original[off:off+length])
 name=tables[b'name'];count=struct.unpack_from('>H',name,2)[0];start=struct.unpack_from('>H',name,4)[0];records=[];strings=bytearray()
 for i in range(count):
  platform,encoding,language,ident,length,offset=struct.unpack_from('>6H',name,6+i*12);value=bytes(name[start+offset:start+offset+length])
  if ident in [1,3,4,6,16]:value=(family.replace(' ','') if ident==6 else family).encode('utf-16-be' if platform in [0,3] else 'mac_roman')
  if ident in [2,17]:value='Regular'.encode('utf-16-be' if platform in [0,3] else 'mac_roman')
  records.append(struct.pack('>6H',platform,encoding,language,ident,len(value),len(strings)));strings.extend(value)
 tables[b'name']=struct.pack('>3H',0,len(records),6+12*len(records))+b''.join(records)+strings
 for tag,fields in changes.items():
  for offset,value in fields.items():struct.pack_into('>h',tables[tag.encode()],int(offset),value)
 struct.pack_into('>I',tables[b'head'],8,0)
 tables.pop(b'DSIG',None);n=len(tables);power=2**(n.bit_length()-1);header=struct.pack('>I4H',0x10000,n,power*16,power.bit_length()-1,n*16-power*16)
 directory=bytearray();data=bytearray();offset=12+n*16;headOffset=0
 for tag,b in sorted(tables.items()):
  directory.extend(struct.pack('>4sIII',tag,checksum(b),offset,len(b)))
  if tag==b'head':headOffset=offset
  padded=bytes(b)+b'\0'*((-len(b))%4);data.extend(padded);offset+=len(padded)
 result=bytearray(header+directory+data);struct.pack_into('>I',result,headOffset+8,(0xb1b0afba-checksum(result))&0xffffffff)
 path=(output or ROOT)/(family.replace(' ','')+'.ttf');path.write_bytes(result);return path

if __name__ == '__main__':
 from zipfile import ZipFile,ZIP_DEFLATED
 import shutil
 variants=[('Base',{}),('WinAsc',{'OS/2':{74:1350}}),('WinDesc',{'OS/2':{76:750}}),('TypoAsc',{'OS/2':{68:1300}}),('TypoDesc',{'OS/2':{70:-700}}),('HheaAsc',{'hhea':{4:1300}}),('HheaDesc',{'hhea':{6:-700}})]
 cases=[];body=[];files=[]
 for mode in ['Cap','Fallback']:
  for label,variation in variants:
   family='SPos '+mode+' '+label
   changes={'OS/2':{24:700 if mode=='Cap' else 0,16:250}}
   for tag,fields in variation.items():changes.setdefault(tag,{}).update(fields)
   files.append(build(family,changes).name)
   body.append('<w:p><w:pPr>'+('<w:pageBreakBefore/>' if cases else '')+'</w:pPr><w:r><w:t>'+family+'</w:t></w:r></w:p>')
   rows=[]
   for size in [12,20]:
    for script in ['superscript','subscript']:
     runs=[]
     for text,active in [('START ',False),('TEST',True),(' END',False)]:
      props=f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/><w:sz w:val="{size*2}"/>'+(f'<w:vertAlign w:val="{script}"/>' if active else '')
      runs.append('<w:r><w:rPr>'+props+'</w:rPr><w:t xml:space="preserve">'+text+'</w:t></w:r>')
     body.append('<w:p>'+''.join(runs)+'</w:p>');rows.append(dict(size=size,script=script))
   cases.append(dict(family=family,mode=mode,variant=label,changes=changes,rows=rows))
 document='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join(body)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
 types='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
 rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
 with ZipFile(ROOT/'controls.docx','w',ZIP_DEFLATED) as z:
  for name,value in {'[Content_Types].xml':types,'_rels/.rels':rels,'word/document.xml':document}.items():z.writestr(name,value)
 (ROOT/'fonts.json').write_text(json.dumps(files,indent=2)+'\n')
 (ROOT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
 shutil.copyfile(ROOT.parent/'script-metric-controls/OFL.txt',ROOT/'OFL.txt')
 print('Generated',len(cases),'original font variants with 56 native script-position cases')
