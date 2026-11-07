"""Native reference integrity, not a passing renderer fidelity claim."""
import importlib.util,json,struct,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from record_rotated_phase_metafiles import record,baseline_records,FOLDER

class RotatedPhaseMetafiles(unittest.TestCase):
 def test_reconstructs_bound_reference_and_paired_extractions(self):
  result=record()
  self.assertEqual(result,json.loads((FOLDER/'native-reference.json').read_text()))
  self.assertEqual([c['twips']for c in result['cases']],[0,1,2,3,4,5,10,20])
  for c in result['cases']:
   self.assertEqual(c['logicalUnitPt'],.12)
   self.assertEqual(len(c['rows']),12)
   self.assertLess(c['maximumPdfIncrementDifferencePt'],.01)

 def test_nonmonotonic_shift_is_present_before_pdf_export(self):
  cases=record()['cases']
  self.assertEqual(cases[0]['rows'][8]['logicalX'],1375)
  self.assertEqual(cases[1]['rows'][8]['logicalX'],1374)
  self.assertGreater(cases[1]['rows'][6]['logicalX'],cases[0]['rows'][6]['logicalX'])
  for before,after in zip(cases,cases[1:]):
   for a,b in zip(before['rows'][:6],after['rows'][:6]):self.assertGreaterEqual(b['logicalX'],a['logicalX'])

 def test_rejects_truncated_or_unmapped_records(self):
  data=(FOLDER/'native-page-1.emf').read_bytes()
  with self.assertRaises(ValueError):baseline_records(data[:-1])
  changed=bytearray(data);offset=0
  while offset<len(data):
   kind,size=struct.unpack_from('<II',data,offset)
   if kind==22:struct.pack_into('<I',changed,offset+8,0);break
   offset+=size
  with self.assertRaises(ValueError):baseline_records(changed)

if __name__=='__main__':unittest.main()
