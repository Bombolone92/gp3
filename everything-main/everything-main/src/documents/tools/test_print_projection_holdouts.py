"""Independent physical/PDF rectangle holdouts for proposed projection rules."""
from pathlib import Path
import hashlib,json,math,unittest
from pypdf import PdfReader
from pypdf.generic import ContentStream
from native_rectangle_pdf import rectangle_fills
from compare_print_reference_recapture import geometry_digest

ROOT=Path(__file__).resolve().parents[1]
REFERENCE=json.loads((ROOT/'tests/fixtures/print-projection-holdouts/reference.json').read_bytes())
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
nearest=lambda v:math.floor(v+.5+1e-8)
sig=lambda v:float(format(v,'.5g'))
project=lambda u,paper:nearest(u*.12*(1+.12/paper)/.024)*.024

def blue_rectangles(page,reader):
    path=[];rects=[];rgb=None;clips=False;pending_clip=False;rectangular=True;stack=[]
    for args,op in ContentStream(page.get_contents(),reader).operations:
        assert op!=b'cm','Unexpected transform'
        if op==b'q':stack.append((rgb,clips))
        elif op==b'Q':rgb,clips=stack.pop()
        elif op==b'rg':rgb=list(map(float,args))
        elif op==b're':
            values=list(map(float,args));assert all(map(math.isfinite,values))
            path.append(values)
        elif op in [b'm',b'l',b'c',b'v',b'y',b'h']:rectangular=False
        elif op in [b'W',b'W*']:pending_clip=True
        elif op in [b'f',b'f*'] and rgb==[.427,.498,.569]:
            assert not clips and rectangular,'Blue geometry must be unclipped rectangles'
            rects.extend(path)
        if op in [b'n',b'f',b'f*',b'S',b's',b'B',b'B*',b'b',b'b*']:
            if pending_clip:clips=True;pending_clip=False
            path=[];rectangular=True
    assert not stack and not pending_clip
    return rects

class ProjectionHoldoutTests(unittest.TestCase):
    def test_fresh_owned_row_capture_retains_all_fill_and_clip_operands(self):
        capture=json.loads((ROOT/'tests/fixtures/print-row-phase/recapture-2026-10-05.json').read_bytes())
        folder=ROOT/'tests/fixtures/print-row-phase'
        self.assertEqual(sha(folder/'control.docx'),capture['sourceSha256'])
        self.assertEqual(sha(folder/'native.pdf'),capture['referencePdfSha256'])
        self.assertTrue(capture['sourceUnchanged'] and capture['allNativeOperandsUnchanged'])
        self.assertTrue(capture['helperConfirmedExactPath'] and capture['visibleSavedStateObserved'])
        pdf=PdfReader(folder/'native.pdf')
        self.assertEqual(len(pdf.pages),len(capture['pages']))
        total=0
        for page,record in zip(pdf.pages,capture['pages']):
            fills=rectangle_fills(page,pdf)
            self.assertEqual(len(fills),record['rectangleFills'])
            self.assertEqual(geometry_digest(fills),record['retainedGeometrySha256'])
            self.assertEqual(record['freshGeometrySha256'],record['retainedGeometrySha256'])
            self.assertTrue(record['allFillAndClipOperandsIdentical'])
            self.assertEqual(record['blueRectangles'],12)
            total+=len(fills)
        self.assertEqual(total,224)

    def test_all_native_operations_reject_both_universal_projection_rules(self):
        totals=[0,0,0]
        for control in REFERENCE['controls']:
            with self.subTest(fixture=control['fixture']):
                folder=ROOT/'tests/fixtures'/control['fixture']
                for file,key in [('control.docx','sourceSha256'),('cases.json','casesSha256'),('native.pdf','pdfSha256'),('native-metafile-rectangles.json','rawReferenceSha256')]:
                    self.assertEqual(sha(folder/file),control[key])
                raw=json.loads((folder/'native-metafile-rectangles.json').read_bytes())
                pdf=PdfReader(folder/'native.pdf');self.assertEqual(len(pdf.pages),control['pages'])
                self.assertTrue(raw['sourceUnchanged']);self.assertEqual(raw['sourceSha256'],control['sourceSha256'])
                self.assertEqual(raw['casesSha256'],control['casesSha256'])
                counts=[0,0,0]
                for i,page in enumerate(pdf.pages):
                    self.assertFalse(page['/Resources'].get('/Font'),'Geometry references must not redistribute fonts')
                    height=float(page.mediabox.height)
                    rects=blue_rectangles(page,pdf)
                    native=[r['destination'] for r in raw['pages'][i]['fills'] if r['colorRef']==0x917f6d]
                    self.assertEqual(len(rects),len(native));self.assertEqual(len(native)%12,0)
                    for j,([x,y,w,h],actual) in enumerate(zip(native,rects)):
                        if w>=h:
                            lead=project(y+math.ceil(h/2),height)-math.ceil(h/2)*.12
                            end=lead+h*.12
                        else:lead,end=project(y,height),project(y+h,height)
                        direct=[sig(height-end),sig(end-lead)]
                        origin=native[j//12*12];oy,oh=origin[1],origin[3]
                        shift=project(oy+math.ceil(oh/2),height)-math.ceil(oh/2)*.12-oy*.12
                        fixed=[sig(height-(y+h)*.12-shift),sig(h*.12)]
                        counts[0]+=1
                        for k,predicted in enumerate([direct,fixed],1):
                            counts[k]+=max(abs(predicted[0]-actual[1]),abs(predicted[1]-actual[3]))>REFERENCE['tolerancePt']
                self.assertEqual(counts,[control['blueRectangles'],control['centerEndpointMismatches'],control['frameShiftMismatches']])
                totals=[a+b for a,b in zip(totals,counts)]
        self.assertEqual(totals,[1008,154,14])

    def test_same_raw_height_has_different_native_pdf_extents_and_capture_stays_stable(self):
        for example in REFERENCE['examples']:
            folder=ROOT/'tests/fixtures'/example['fixture']
            raw=json.loads((folder/'native-metafile-rectangles.json').read_bytes())
            blue=[r['destination'] for r in raw['pages'][example['page']]['fills'] if r['colorRef']==0x917f6d]
            self.assertEqual(blue[0],example['originRectangle'])
            self.assertEqual(blue[example['rectangle']],example['rawRectangle'])
            pdf=PdfReader(folder/'native.pdf');page=pdf.pages[example['page']]
            self.assertEqual(float(page.mediabox.height),example['pageHeightPt'])
            self.assertEqual(blue_rectangles(page,pdf)[example['rectangle']],example['nativePdfRectangle'])
        first,second=REFERENCE['examples']
        self.assertEqual(first['rawRectangle'][3],second['rawRectangle'][3])
        self.assertEqual(first['rawRectangle'][3],159)
        self.assertAlmostEqual(second['nativePdfRectangle'][3]-first['nativePdfRectangle'][3],.024,places=10)
        after=REFERENCE['afterPdfCapture']
        self.assertTrue(after['savedBefore'] and after['savedAfter'] and after['sourceUnchanged'])
        raw=json.loads((ROOT/'tests/fixtures'/after['fixture']/'native-metafile-rectangles.json').read_bytes())
        self.assertEqual(after['sourceSha256'],raw['sourceSha256'])
        self.assertEqual(after['metafileHashesUnchanged'],[p['sha256'] for p in raw['pages']])

if __name__=='__main__':unittest.main()
