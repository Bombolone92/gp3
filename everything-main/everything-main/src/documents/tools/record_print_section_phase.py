"""Record independently exported native filled rectangles (pypdf: BSD-3-Clause)."""
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DecodedStreamObject
import argparse, hashlib, json
from zipfile import ZipFile
from xml.etree import ElementTree as ET

parser=argparse.ArgumentParser()
parser.add_argument('kind',choices=['row-width','paper','high-row','paper-height','tie'])
parser.add_argument('pdf',type=Path)
parser.add_argument('owned_source',type=Path)
parser.add_argument('--source-sha256',required=True)
args=parser.parse_args()
folder=Path(__file__).resolve().parents[1]/'tests/fixtures'/('print-'+args.kind+'-phase')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(folder/'control.docx')==sha(args.owned_source)==args.source_sha256
with ZipFile(args.owned_source) as package:
    document=ET.fromstring(package.read('word/document.xml'))
    assert all(not (node.text or '').strip() for node in document.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')), 'Control must remain textless'
cases=json.loads((folder/'cases.json').read_bytes())
reader=PdfReader(args.pdf)
assert len(reader.pages)==len(cases)
assert 'Microsoft' in str(reader.metadata.producer)
frames=[]; writer=PdfWriter()
for index,(page,case) in enumerate(zip(reader.pages,cases)):
    width,height=case.get('pageWidthPt',612),case.get('pageHeightPt',792)
    assert list(page.mediabox)==[0,0,width,height] and case['page']==index
    resources=page.get('/Resources').get_object()
    assert not resources.get('/XObject'), 'Control must contain no external pictures'
    # Do not copy resources or inspect font programs. The export embeds a font for
    # its mandatory empty paragraph. Reconstruct only native rectangle fills.
    rects=[];path=[];rgb=None;stack=[];fills=[];clips=[];pending_clip=False;rectangle_path=True
    for operands,op in ContentStream(page.get_contents(),reader).operations:
        assert op!=b'cm','Unexpected transform; account for it explicitly'
        if op==b'q': stack.append((rgb,list(clips)))
        elif op==b'Q': rgb,clips=stack.pop()
        elif op==b'rg': rgb=[float(v) for v in operands]
        elif op==b're': path.append([float(v) for v in operands])
        elif op in (b'm',b'l',b'c',b'v',b'y',b'h'): rectangle_path=False
        elif op in (b'W',b'W*'): pending_clip=True
        elif op in (b'f',b'f*'):
            # Reconstructing a clipped rectangle without its clip could make
            # the independent reference larger than the actual native painting.
            assert not path or rectangle_path, 'Nonrectangle fill needs explicit reconstruction'
            assert not path or all(clip is not None for clip in clips), 'Nonrectangle clipping needs explicit reconstruction'
            # Frame measurements describe ink, not an unclipped bounding box.
            assert rgb!=[.427,.498,.569] or not clips, 'Clipped border needs explicit measurement'
            if rgb==[.427,.498,.569]: rects.extend(path)
            if path:
                assert rgb is not None
                fills.append((rgb,list(path),list(clips)))
        # Empty paragraphs in the export can emit a whitespace glyph. Its font data is
        # neither inspected nor copied; these references cover rectangles only.
        if op in (b'n',b'f',b'f*',b'S',b's',b'B',b'B*',b'b',b'b*'):
            if pending_clip:
                # PDF applies W/W* when the current path is terminated,
                # after painting if the terminating operator also paints.
                clips.append(path[0] if rectangle_path and len(path)==1 else None)
                pending_clip=False
            path=[]
            rectangle_path=True
    assert len(rects)==12 and not stack and not pending_clip
    horizontal=[r for r in rects if r[2]>100 and 0<r[3]<4]
    vertical=[r for r in rects if r[3]>5 and 0<r[2]<4]
    assert len(horizontal)==len(vertical)==2
    frames.append(dict(**case,boundsPt=[min(r[0] for r in rects),height-max(r[1]+r[3] for r in rects),
        max(r[0]+r[2] for r in rects),height-min(r[1] for r in rects)],
        horizontalWidthsPt=[r[3] for r in horizontal],verticalWidthsPt=[r[2] for r in vertical]))
    lines=[]
    for color,rectangles,active_clips in fills:
        if active_clips:
            lines.append('q')
            for clip in active_clips:
                lines.append(' '.join(format(v,'.12g') for v in clip)+' re W n')
        lines.append(' '.join(format(v,'.12g') for v in color)+' rg')
        for rectangle in rectangles:
            lines.append(' '.join(format(v,'.12g') for v in rectangle)+' re f*')
        if active_clips: lines.append('Q')
    output=writer.add_blank_page(width=width,height=height)
    stream=DecodedStreamObject();stream.set_data(('\n'.join(lines)+'\n').encode('ascii'))
    output.replace_contents(stream)
assert sha(args.owned_source)==args.source_sha256
writer.add_metadata({'/Title':'Native reference rectangle geometry; no fonts or text','/SourcePDFSHA256':sha(args.pdf)})
with (folder/'native.pdf').open('wb') as target: writer.write(target)
geometry=PdfReader(folder/'native.pdf')
assert len(geometry.pages)==len(frames)
assert all(not p.get('/Resources').get_object().get('/Font') for p in geometry.pages)
reference=dict(sourceSha256=args.source_sha256,casesSha256=sha(folder/'cases.json'),pdfSha256=sha(folder/'native.pdf'),nativeSourcePdfSha256=sha(args.pdf),
    sourceUnchanged=True,pageCount=len(frames),
    method='Visible reference PDF/XPS export of exact owned source; native rectangle fills and rectangular clipping reconstructed without fonts/text; original PDF hash retained; no renderer input',frames=frames)
(folder/'native-print-frames.json').write_bytes((json.dumps(reference,indent=2)+'\n').encode())
print(f'Recorded {len(frames)} native {args.kind} frames; owned source unchanged; font-free rectangle PDF.')
