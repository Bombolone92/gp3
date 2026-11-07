import json,shutil,struct,sys,tempfile,unittest,zlib
from fractions import Fraction
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from emfplus_image_objects import extract_png_objects
from record_picture_3d_transfer import measure
from picture_3d_color_transfer_fixture import generate

ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/picture-3d-transfer'


def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)


def image():
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\x14\x50\xbe'))+chunk(b'IEND',b'')
    return struct.pack('<7I',1,1,1,1,0,0,1)+png


def emf(objects):
    records=[]
    for flags,payload in objects:
        padding=(-len(payload))%4
        record=struct.pack('<HHII',0x4008,flags,12+len(payload)+padding,len(payload))+payload+b'\0'*padding
        comment=b'EMF+'+record
        records.append(struct.pack('<III',70,12+len(comment),len(comment))+comment)
    header=bytearray(88);struct.pack_into('<II',header,0,1,88);header[40:44]=b' EMF'
    struct.pack_into('<II',header,48,88+sum(map(len,records)),len(records)+1)
    return bytes(header)+b''.join(records)


class ImageObjectsTests(unittest.TestCase):
    def test_standalone_and_word_final_continue_bit(self):
        raw=image();single=extract_png_objects(emf([(0x0501,raw)]))[0]
        split=extract_png_objects(emf([(0x8501,struct.pack('<I',len(raw))+raw[:41]),(0x8501,struct.pack('<I',len(raw))+raw[41:])]))[0]
        self.assertEqual(single['png'],split['png']);self.assertEqual(split['size'],[1,1])
        self.assertEqual(split['chunks'],2);self.assertTrue(split['lastChunkContinueBit'])

    def test_rejects_malformed_continuations(self):
        raw=image();first=(0x8501,struct.pack('<I',len(raw))+raw[:41])
        cases=[emf([first]),emf([first,(0x8501,struct.pack('<I',len(raw)+1)+raw[41:])]),
               emf([(0x8501,struct.pack('<I',len(raw)-1)+raw)]),emf([first,(0x0101,b'')]),
               emf([first,(0x0501,raw[41:])]),emf([(0x0540,raw)]),emf([(0x8501,struct.pack('<I',33*1024*1024))])]
        for data in cases:
            with self.subTest(size=len(data)),self.assertRaises(ValueError):extract_png_objects(data)

    def test_rejects_invalid_png_and_record_metadata(self):
        raw=image();damaged=bytearray(raw);damaged[65]^=1
        cases=[emf([(0x0501,bytes(damaged))]),emf([(0x0501,raw+b'bad tail')])]
        data=bytearray(emf([(0x0501,raw)]));struct.pack_into('<I',data,48,len(data)+4);cases.append(data)
        data=bytearray(emf([(0x0501,raw)]));struct.pack_into('<I',data,52,99);cases.append(data)
        data=bytearray(emf([(0x0501,raw)]));struct.pack_into('<I',data,112,999999);cases.append(data)
        for data in cases:
            with self.subTest(size=len(data)),self.assertRaises(ValueError):extract_png_objects(data)

    def test_reproduces_all_certified_native_samples(self):
        for name in ['rgb64','gray256','matte-gray256']:
            root=ROOT/name;actual=measure(root)
            self.assertEqual(actual,json.loads((root/'reference.json').read_text()))
            if name!='matte-gray256':self.assertEqual(actual['measurements'][0]['colors'],actual['measurements'][1]['colors'])
            self.assertTrue(all(row['image']['chunks']>=2 and row['image']['lastChunkContinueBit'] for row in actual['measurements']))

    def test_reproduces_owned_source_bytes_and_avoids_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ['rgb64','gray256','matte-gray256']:
                target=Path(folder)/name;generate(target,name!='rgb64',name=='matte-gray256')
                self.assertEqual((target/'source.docx').read_bytes(),(ROOT/name/'source.docx').read_bytes())
                self.assertEqual(json.loads((target/'cases.json').read_text()),json.loads((ROOT/name/'cases.json').read_text()))
                with self.assertRaises(FileExistsError):generate(target)

    def test_native_grid_rejects_three_point_candidate(self):
        rows=measure(ROOT/'gray256')['measurements']
        self.assertEqual(rows[0]['colors'][192],[205]*3)
        self.assertEqual(round(Fraction(133,128)*192+5),204)
        self.assertEqual(rows[2]['colors'],[[min(255,round(Fraction(63,64)*x+6))]*3 for x in range(256)])
        matte=measure(ROOT/'matte-gray256')['measurements']
        self.assertEqual(matte[0]['colors'],rows[0]['colors'])
        self.assertEqual(matte[1]['colors'],[[min(255,round(Fraction(133,128)*x))]*3 for x in range(256)])
        self.assertEqual(matte[2]['colors'],[[round(Fraction(63,64)*x)]*3 for x in range(256)])

    def test_capture_guards_reject_altered_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'control';shutil.copytree(ROOT/'rgb64',root)
            path=root/'native/capture.json';original=path.read_text(encoding='utf-8-sig');capture=json.loads(original)
            for key,value in [('sourceUnchanged',False),('savedAfter',True),('viewAfter',{}),('sourceSha256','0'*64)]:
                changed={**capture,key:value};path.write_text(json.dumps(changed))
                with self.subTest(key=key),self.assertRaises(ValueError):measure(root)
            changed=json.loads(original);changed['captures'][0]['sha256']='0'*64;path.write_text(json.dumps(changed))
            with self.assertRaises(ValueError):measure(root)


if __name__=='__main__':unittest.main()
