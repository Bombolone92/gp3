"""Face-name discovery uses catalog/stat data without reading font programs."""
from pathlib import Path
import json, tempfile, unittest, subprocess, sys
from unittest.mock import patch
from audit_installed_font_cache import audit

class FontCacheTests(unittest.TestCase):
    def test_family_and_face_aliases_are_distinct_and_programs_remain_opaque(self):
        with tempfile.TemporaryDirectory() as scratch:
            root=Path(scratch);(root/'Catalog').mkdir();(root/'CloudFonts/Own Family').mkdir(parents=True)
            (root/'CloudFonts/Own Family/1.ttf').write_bytes(b'opaque own fixture')
            (root/'Catalog/ListAll.Json').write_text(json.dumps(dict(MajorVersion=4,MinorVersion=42,Fonts=[
                dict(f='Own Family',sf=[dict(dn='Own Family Regular',id=1,t='ttf',fs=18,v=1),
                    dict(dn='Own Family Light',id=2,t='ttf',fs=20,v=1)])])))
            original=Path.read_bytes
            def read_only_catalog(path):
                self.assertEqual(path,root/'Catalog/ListAll.Json')
                return original(path)
            with patch.object(Path,'read_bytes',read_only_catalog):
                result=audit(root,['Own Family','own family light','Missing'])
            family,face,missing=result['families']
            self.assertEqual(family['presentFaces'],1)
            self.assertEqual(len(family['faces']),2)
            self.assertNotIn('matchedAs',family)
            self.assertEqual(face['matchedAs'],'face')
            self.assertEqual(face['catalogFamilies'],['Own Family'])
            self.assertEqual([f['face'] for f in face['faces']],['Own Family Light'])
            self.assertEqual(face['presentFaces'],0)
            self.assertFalse(missing['catalogFound'])
            self.assertEqual(missing['faces'],[])

    def test_cli_cannot_replace_its_catalog_input(self):
        with tempfile.TemporaryDirectory() as scratch:
            root=Path(scratch);(root/'Catalog').mkdir()
            source=root/'Catalog/ListAll.Json'
            data=json.dumps(dict(MajorVersion=4,MinorVersion=42,Fonts=[])).encode()
            source.write_bytes(data)
            script=Path(__file__).with_name('audit_installed_font_cache.py')
            result=subprocess.run([sys.executable,str(script),str(root),str(source),'--family','Missing'],
                capture_output=True,text=True,timeout=10)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('FileExistsError',result.stderr)
            self.assertEqual(source.read_bytes(),data)

if __name__=='__main__':unittest.main()
