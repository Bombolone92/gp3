"""Read bounded PNG object bytes from native EMF+; never play drawing/font records.

MS-EMFPLUS §§2.2.1.4, 2.2.2.2/10, 2.3.5.1. Native captures can keep C set on the
last chunk; the declared TotalObjectSize establishes completion. Retain that
observation explicitly rather than silently assuming a following chunk.
"""
import struct,zlib
from hashlib import sha256

MAX_OBJECT_BYTES=32*1024*1024
MAX_PIXELS=4*1024*1024


def require(condition,message):
    if not condition:raise ValueError(message)


def png_bytes(payload):
    require(len(payload)>=36 and struct.unpack_from('<I',payload,4)[0]==1 and struct.unpack_from('<I',payload,24)[0]==1,'Expected compressed bitmap object')
    png=payload[28:];require(png[:8]==b'\x89PNG\r\n\x1a\n','Expected PNG')
    at=8;dimensions=None
    while at<len(png):
        require(at+12<=len(png),'Truncated PNG chunk')
        size=struct.unpack_from('>I',png,at)[0];end=at+12+size
        require(end<=len(png),'Truncated PNG data')
        kind=png[at+4:at+8];body=png[at+8:at+8+size]
        require(zlib.crc32(kind+body)&0xffffffff==struct.unpack_from('>I',png,end-4)[0],'PNG CRC mismatch')
        if dimensions is None:
            require(kind==b'IHDR' and size==13,'Missing PNG header')
            dimensions=struct.unpack_from('>II',body)
            require(all(0<v<=4096 for v in dimensions) and dimensions[0]*dimensions[1]<=MAX_PIXELS,'PNG exceeds diagnostic image budget')
        if kind==b'IEND':
            require(size==0 and len(png)-end<=3 and not any(png[end:]),'Unexpected PNG tail')
            return png[:end],dimensions
        at=end
    raise ValueError('Missing PNG end')


def extract_png_objects(data):
    require(len(data)>=88 and struct.unpack_from('<I',data)[0]==1 and data[40:44]==b' EMF','Invalid EMF header')
    require(struct.unpack_from('<I',data,48)[0]==len(data),'EMF byte count mismatch')
    pos=0;records=0;pending={};result=[]
    while pos<len(data):
        require(pos+8<=len(data),'Truncated EMF header')
        kind,size=struct.unpack_from('<II',data,pos)
        require(size>=8 and size%4==0 and pos+size<=len(data),'Invalid EMF record')
        if kind==70:
            require(size>=12,'Truncated comment')
            count=struct.unpack_from('<I',data,pos+8)[0];require(count<=size-12,'Invalid comment size')
            end=pos+12+count
            if data[pos+12:pos+16]==b'EMF+':
                at=pos+16
                while at<end:
                    require(at+12<=end,'Truncated EMF+ header')
                    tag,flags,length,n=struct.unpack_from('<HHII',data,at)
                    require(length>=12 and length%4==0 and at+length<=end and n<=length-12,'Invalid EMF+ record')
                    payload=data[at+12:at+12+n]
                    if tag==0x4008:
                        slot=flags&255;object_type=flags>>8&127
                        require(slot<=63,'Invalid object slot')
                        require(slot not in pending or object_type==5,'Incomplete image object overwritten')
                        if object_type==5:
                            chunks=1;last_continued=False
                            if flags&0x8000:
                                require(len(payload)>=4,'Missing total object size')
                                total=struct.unpack_from('<I',payload)[0]
                                require(36<=total<=MAX_OBJECT_BYTES,'Invalid total object budget')
                                state=pending.setdefault(slot,{'total':total,'data':bytearray(),'chunks':0})
                                require(state['total']==total,'Conflicting total object size')
                                require(len(payload)-4<=total-len(state['data']),'Object exceeds declared total')
                                state['data'].extend(payload[4:]);state['chunks']+=1
                                if len(state['data'])==total:
                                    payload=bytes(state['data']);chunks=state['chunks'];last_continued=True;del pending[slot]
                                else:
                                    at+=length;continue
                            else:
                                require(slot not in pending,'Unimplemented clear-C continuation form')
                                require(len(payload)<=MAX_OBJECT_BYTES,'Image exceeds object budget')
                            png,dimensions=png_bytes(payload)
                            result.append({'objectId':slot,'chunks':chunks,'lastChunkContinueBit':last_continued,'objectSha256':sha256(payload).hexdigest(),'pngSha256':sha256(png).hexdigest(),'size':list(dimensions),'png':png})
                    at+=length
        pos+=size;records+=1
    require(not pending,'Incomplete continued image')
    require(records==struct.unpack_from('<I',data,52)[0],'EMF record count mismatch')
    return result
