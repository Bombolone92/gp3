"""Retain native rectangle fills/clips without copying text or font resources.

Uses pypdf (BSD-3-Clause). Native source PDFs stay private; this is deliberately
not a general PDF sanitizer or a replacement for the document renderer.
"""
from pathlib import Path
from hashlib import sha256
from io import BytesIO
import math
from pypdf import PdfReader,PdfWriter
from pypdf.generic import ContentStream,DecodedStreamObject

BLUE=[.427,.498,.569]

def rectangle_fills(page,reader):
    resources=page.get('/Resources').get_object()
    assert not resources.get('/XObject'),'Unexpected external pictures'
    path=[];rgb=None;clips=[];stack=[];pending_clip=False;rectangular=True;fills=[]
    for args,op in ContentStream(page.get_contents(),reader).operations:
        assert op!=b'cm','Unexpected transform; account for it explicitly'
        assert op not in [b'Do',b'sh',b'INLINE IMAGE',b'cs',b'sc',b'scn'],'Unsupported external graphics state or fill paint'
        if op==b'q':stack.append((rgb,list(clips)))
        elif op==b'Q':rgb,clips=stack.pop()
        elif op==b'rg':rgb=[float(v) for v in args]
        elif op==b'g':rgb=[float(args[0])]*3
        elif op==b'k':rgb=None
        elif op==b'gs':
            states=resources.get('/ExtGState')
            if states is not None:states=states.get_object()
            assert states is not None and states.get(args[0]) is not None,'Unsupported graphics state'
            state=states[args[0]].get_object()
            assert set(state)<=set(['/Type','/BM','/ca','/CA']),'Unsupported graphics state'
            assert state.get('/Type','/ExtGState')=='/ExtGState' and state.get('/BM','/Normal')=='/Normal','Unsupported blend mode'
            assert state.get('/ca',1)==state.get('/CA',1)==1,'Unsupported opacity'
        elif op==b're':
            rect=list(map(float,args));assert all(map(math.isfinite,rect))
            path.append(rect)
        elif op in [b'm',b'l',b'c',b'v',b'y',b'h']:rectangular=False
        elif op in [b'W',b'W*']:pending_clip=True
        elif op in [b'f',b'f*'] and (path or not rectangular):
            assert rectangular,'Nonrectangle fill needs explicit reconstruction'
            assert len(path)==1,'Multiple subpaths need explicit fill-rule reconstruction'
            assert all(clip is not None for clip in clips),'Nonrectangle clipping needs explicit reconstruction'
            assert rgb is not None and len(rgb)==3 and all(math.isfinite(v) and 0<=v<=1 for v in rgb),'Unsupported fill color'
            assert rgb!=BLUE or not clips,'Clipped border needs explicit measurement'
            fills.append((list(rgb),list(path),list(clips)))
        elif op in [b'S',b's',b'B',b'B*',b'b',b'b*'] and (path or not rectangular):
            raise AssertionError('Stroked paths need explicit reconstruction')
        if op in [b'n',b'f',b'f*',b'S',b's',b'B',b'B*',b'b',b'b*']:
            if pending_clip:
                clips.append(path[0] if rectangular and len(path)==1 else None)
                pending_clip=False
            path=[];rectangular=True
    assert not stack and not pending_clip and not path
    return fills

def reconstruct_rectangle_pdf(source,target,expected_blue_counts):
    source=Path(source);target=Path(target)
    assert source.resolve()!=target.resolve(),'Keep the native source separate'
    digest=sha256(source.read_bytes()).hexdigest()
    reader=PdfReader(source);writer=PdfWriter()
    assert all(isinstance(n,int) and not isinstance(n,bool) and n>0 for n in expected_blue_counts),'Expected counts must be positive integers'
    assert len(reader.pages)==len(expected_blue_counts)
    for page,expected in zip(reader.pages,expected_blue_counts):
        assert list(page.mediabox)[:2]==[0,0]
        fills=rectangle_fills(page,reader)
        assert sum(len(rects) for rgb,rects,clips in fills if rgb==BLUE)==expected,'Unexpected blue rectangle count'
        lines=[]
        for rgb,rects,clips in fills:
            if clips:
                lines.append('q')
                for clip in clips:lines.append(' '.join(format(v,'.12g') for v in clip)+' re W n')
            lines.append(' '.join(format(v,'.12g') for v in rgb)+' rg')
            for rect in rects:lines.append(' '.join(format(v,'.12g') for v in rect)+' re f*')
            if clips:lines.append('Q')
        output=writer.add_blank_page(width=float(page.mediabox.width),height=float(page.mediabox.height))
        stream=DecodedStreamObject();stream.set_data(('\n'.join(lines)+'\n').encode('ascii'))
        output.replace_contents(stream)
    assert sha256(source.read_bytes()).hexdigest()==digest,'Native source changed'
    writer.add_metadata({'/Title':'Native reference rectangle geometry; no fonts or text','/SourcePDFSHA256':digest})
    buffer=BytesIO();writer.write(buffer);payload=buffer.getvalue()
    clean=PdfReader(BytesIO(payload))
    assert len(clean.pages)==len(expected_blue_counts)
    assert all(not page.get('/Resources').get_object().get('/Font') for page in clean.pages)
    for original,output in zip(reader.pages,clean.pages):
        assert rectangle_fills(original,reader)==rectangle_fills(output,clean),'Rectangle operands or clips changed'
    target.write_bytes(payload)
    return sha256(payload).hexdigest()
