"""Check independent native geometry and discriminate row/border rounding."""
from pathlib import Path
from hashlib import sha256
import json, unittest
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from pypdf import PdfReader
from native_rectangle_pdf import rectangle_fills, BLUE

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures'

def reference(name):
    folder = ROOT / name
    data = json.loads((folder/'native-print-frames.json').read_bytes())
    for filename, key in [('control.docx','sourceSha256'), ('cases.json','casesSha256'), ('native.pdf','pdfSha256')]:
        assert sha256((folder/filename).read_bytes()).hexdigest() == data[key]
    return folder, data

class RowPenPhaseTests(unittest.TestCase):
    def test_independent_native_rectangles_and_all_eighty_cases(self):
        folder, data = reference('print-row-pen-phase')
        cases = json.loads((folder/'cases.json').read_bytes())
        reader = PdfReader(folder/'native.pdf')
        self.assertEqual(len(reader.pages), 80)
        self.assertEqual(len(cases), 80)
        self.assertTrue(data['sourceUnchanged'])
        with ZipFile(folder/'control.docx') as package:
            document = ET.fromstring(package.read('word/document.xml'))
        w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        tables = document.findall('.//'+w+'tbl')
        self.assertEqual(len(tables), 80)
        for table, case in zip(tables, cases):
            height = table.find('.//'+w+'trHeight')
            self.assertEqual(height.get(w+'hRule'), 'exact')
            self.assertEqual(int(height.get(w+'val')), case['heightTwips'])
            for border in table.find('.//'+w+'tblBorders'):
                self.assertEqual(int(border.get(w+'sz')), case['sizeEighthPoints'])
        for i, (page, frame, case) in enumerate(zip(reader.pages, data['frames'], cases)):
            self.assertEqual(case['index'], i)
            self.assertEqual(case['page'], i)
            self.assertEqual(case['sizeEighthPoints'], [3,5,8,12,16][i//16])
            self.assertEqual(case['heightTwips'], 396+i%16)
            self.assertEqual(list(page.mediabox), [0,0,612,792])
            self.assertFalse(page['/Resources'].get('/Font'))
            rects = [r for rgb, rects, clips in rectangle_fills(page, reader) if rgb==BLUE for r in rects]
            self.assertEqual(len(rects), 12)
            bounds = [min(r[0] for r in rects), 792-max(r[1]+r[3] for r in rects), max(r[0]+r[2] for r in rects), 792-min(r[1] for r in rects)]
            for actual, expected in zip(bounds, frame['boundsPt']):
                self.assertAlmostEqual(actual, expected, places=8)

    def test_forty_repeated_cases_agree_with_prior_independent_captures(self):
        _, data = reference('print-row-pen-phase')
        current = {(f['sizeEighthPoints'],f['heightTwips']):f for f in data['frames']}
        compared = 0
        for name in ['print-row-width-phase','print-row-phase']:
            _, old = reference(name)
            for frame in old['frames']:
                key = (frame['sizeEighthPoints'],frame['heightTwips'])
                if key not in current: continue
                compared += 1
                for a, b in zip(current[key]['boundsPt'], frame['boundsPt']):
                    self.assertAlmostEqual(a, b, places=8)
        self.assertEqual(compared, 40)

    def test_row_rounding_cannot_be_independent_of_border_width(self):
        _, data = reference('print-row-pen-phase')
        far = {(f['sizeEighthPoints'],f['heightTwips']):f['boundsPt'][3] for f in data['frames']}
        # Any model row(height) + constant(border) requires equal differences.
        narrow = far[3,402]-far[3,396]
        wider = far[5,402]-far[5,396]
        self.assertAlmostEqual(narrow, .24, places=8)
        self.assertAlmostEqual(wider, .36, places=8)
        self.assertAlmostEqual(wider-narrow, .12, places=8)

    def test_fresh_raw_native_far_edges_agree_with_all_eighty_pdf_bounds(self):
        folder, data = reference('print-row-pen-phase')
        raw = json.loads((folder/'native-metafile-rectangles.json').read_bytes())
        self.assertEqual(raw['sourceSha256'],data['sourceSha256'])
        self.assertEqual(raw['casesSha256'],data['casesSha256'])
        self.assertTrue(raw['sourceUnchanged'])
        self.assertEqual(len(raw['pages']),80)
        for i,(page,frame) in enumerate(zip(raw['pages'],data['frames'])):
            self.assertEqual(page['page'],i+1)
            self.assertEqual(page['windowExtent'],[5100,6600])
            blue=[r for r in page['fills'] if r['colorRef']==0x917f6d]
            self.assertEqual(len(blue),12)
            self.assertTrue(all(not r['clips'] for r in blue))
            rects=[r['destination'] for r in blue]
            self.assertAlmostEqual(min(r[1] for r in rects)*.12,frame['boundsPt'][1],places=8)
            self.assertAlmostEqual(max(r[1]+r[3] for r in rects)*.12,frame['boundsPt'][3],places=8)

if __name__=='__main__': unittest.main()
