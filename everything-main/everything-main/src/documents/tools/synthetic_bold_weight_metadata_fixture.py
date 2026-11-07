from pathlib import Path
import struct as s, math, json, shutil, argparse
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('output',type=Path);out=parser.parse_args().output;out.mkdir(parents=True,exist_ok=True)
src=(root/'public/fonts/SourceSansPro-Regular.ttf').read_bytes()
tables={}
for i in range(s.unpack_from('>H',src,4)[0]):
 tag,_,off,n=s.unpack_from('>4sIII',src,12+i*16);tables[tag]=src[off:off+n]
def checksum(b):
 b=b+b'\0'*((-len(b))%4);return sum(s.unpack('>'+str(len(b)//4)+'I',b))&0xffffffff
def font(weight):
 ts=dict(tables);name=f'Weight Probe {weight}';post=f'WeightProbe{weight}'
 n=ts[b'name'];_,count,off=s.unpack_from('>HHH',n);records=[];data=b''
 for i in range(count):
  platform,encoding,lang,key,length,start=s.unpack_from('>6H',n,6+12*i)
  b=n[off+start:off+start+length]
  value={1:name,2:'Regular',3:post+'-Regular',4:name,6:post+'-Regular',16:name,17:'Regular',21:name,22:'Regular'}.get(key)
  if value is not None:b=value.encode('utf-16-be' if platform in [0,3] else 'ascii')
  records.append(s.pack('>6H',platform,encoding,lang,key,len(b),len(data)));data+=b
 ts[b'name']=s.pack('>HHH',0,count,6+12*count)+b''.join(records)+data
 o=bytearray(ts[b'OS/2']);s.pack_into('>H',o,4,weight);ts[b'OS/2']=bytes(o)
 h=bytearray(ts[b'head']);s.pack_into('>I',h,8,0);ts[b'head']=bytes(h)
 ts.pop(b'DSIG',None)
 entries=sorted(ts.items());count=len(entries);power=int(math.log2(count));off=12+16*count
 header=s.pack('>IHHHH',s.unpack_from('>I',src)[0],count,16*2**power,power,count*16-16*2**power)
 records=[];data=b'';head=0
 for tag,b in entries:
  records.append(s.pack('>4sIII',tag,checksum(b),off,len(b)))
  if tag==b'head':head=off
  padded=b+b'\0'*((-len(b))%4);data+=padded;off+=len(padded)
 result=bytearray(header+b''.join(records)+data);s.pack_into('>I',result,head+8,(0xb1b0afba-checksum(result))&0xffffffff)
 assert checksum(result)==0xb1b0afba
 (out/(post+'.ttf')).write_bytes(result)
 return name
weights=[100,200,250,299,300,301,349,350,351,399,400,401,499,500,501,550,600,650,700,800,900]
names=[font(w) for w in weights]
shutil.copyfile(root/'public/fonts/SourceSansPro-OFL.txt',out/'OFL.txt')
with ZipFile(root/'tests/fixtures/synthetic-bold-advance/modern.docx') as z:parts={n:z.read(n) for n in z.namelist()}
paras=[];cases=[]
for name,weight in zip(names,weights):
 for bold in [False,True]:
  i=len(cases);text=f'Weight {weight} {"bold" if bold else "regular"} Hamburgefonts'
  cases.append(dict(font=name,weight=weight,bold=bold,text=text,page=i//10))
  br='<w:pageBreakBefore/>' if i and i%10==0 else ''
  props=f'<w:rFonts w:ascii="{name}" w:hAnsi="{name}"/><w:kern w:val="0"/><w:sz w:val="48"/>'+('<w:b/>' if bold else '')
  paras.append(f'<w:p><w:pPr>{br}<w:spacing w:before="0" w:after="0" w:line="840" w:lineRule="exact"/></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r></w:p>')
parts['word/document.xml']=('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join(paras)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
with ZipFile(out/'control.docx','w') as z:
 for n,b in parts.items():
  info=ZipInfo(n,(2026,9,25,5,20,54));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,b,compress_type=ZIP_DEFLATED)
(out/'cases.json').write_text(json.dumps(cases,indent=2))
