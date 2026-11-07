"""Independently reproduce native fill bounds from retained reference screen crops."""
from pathlib import Path
from hashlib import sha256
import json, unittest
from PIL import Image

FOLDER=Path(__file__).resolve().parents[1]/'tests/fixtures/border-phase'
REFERENCE=json.loads((FOLDER/'native-fill-reference.json').read_bytes())

class NativeFillReferenceTests(unittest.TestCase):
    def test_exact_authored_sources_cases_and_native_crops(self):
        self.assertEqual(len(REFERENCE['controls']),2)
        for control in REFERENCE['controls']:
            for key,hash_key in [('source','sourceSha256'),('cases','casesSha256')]:
                self.assertEqual(sha256((FOLDER/control[key]).read_bytes()).hexdigest(),control[hash_key])
            self.assertEqual([o['zoom'] for o in control['observations']],[100,150])
            for observation in control['observations']:
                self.assertEqual(sha256((FOLDER/observation['crop']).read_bytes()).hexdigest(),observation['cropSha256'])

    def test_all_256_edges_are_reproduced_from_native_pixels(self):
        count=0
        for control in REFERENCE['controls']:
            for observation in control['observations']:
                self.assertEqual(observation['redThreshold'],dict(luminanceLessThan=166,
                    luminanceWeights=[.299,.587,.114],rGreaterThan=128,redDominanceGreaterThan=32))
                with Image.open(FOLDER/observation['crop']) as source:
                    self.assertEqual(source.size,tuple(observation['size']))
                    image=source.convert('RGB')
                self.assertEqual(len(observation['regions']),16)
                self.assertEqual(len(observation['comparisons']),16)
                for region,comparison in zip(observation['regions'],observation['comparisons']):
                    x,y,w,h=region
                    points=[]
                    for yy in range(y,y+h):
                        for xx in range(x,x+w):
                            r,g,b=image.getpixel((xx,yy))
                            if .299*r+.587*g+.114*b<166 and r>128 and r>g+32 and r>b+32:
                                points.append((xx,yy))
                    self.assertTrue(points)
                    bounds=[min(p[0] for p in points),min(p[1] for p in points),
                            max(p[0] for p in points)+1,max(p[1] for p in points)+1]
                    self.assertEqual(bounds,comparison['native'])
                    count+=4
        self.assertEqual(count,256)

if __name__=='__main__':unittest.main()
