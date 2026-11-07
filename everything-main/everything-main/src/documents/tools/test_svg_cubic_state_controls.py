import gzip,json
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import unittest
import svg_cubic_state_controls as controls
from svg_cubic_phase_fixture import generate,BASE
from svg_cubic_step_fixture import split


def evaluate(points,t):
    weights=[(1-t)**3,3*(1-t)**2*t,3*(1-t)*t*t,t**3]
    return [sum(Fraction(str(p[k]))*w for p,w in zip(points,weights,strict=True)) for k in range(2)]


class Controls(unittest.TestCase):
    def test_all_affine_controls_have_exact_lattice_and_polynomial_identity(self):
        rows,_=controls.inputs();self.assertEqual(len(rows),504)
        self.assertEqual(len({c['name'] for c in rows}),504)
        for whole,left,right in zip(rows[::3],rows[1::3],rows[2::3],strict=True):
            self.assertEqual([whole['representation'],left['representation'],right['representation']],['whole','left','right'])
            self.assertEqual(split(whole['points']),[left['points'],right['points']])
            for row in [whole,left,right]:
                for point in row['points']:
                    for value in point:self.assertEqual((Fraction(str(value))*16).denominator,1)
            for side,half in enumerate([left,right]):
                for t in [Fraction(0),Fraction(1,3),Fraction(2,3),Fraction(1)]:
                    self.assertEqual(evaluate(half['points'],t),evaluate(whole['points'],(side+t)/2))

    def test_input_generation_repeats_exact_bytes(self):
        with TemporaryDirectory() as directory:
            out=Path(directory);a=controls.generate(out);b=controls.generate(out)
            self.assertEqual(a,b)

    def test_record_reproduces_hash_bound_reference(self):
        fixture=controls.ROOT/'tests/fixtures/svg-cubic-state-controls'
        with TemporaryDirectory() as directory:
            out=Path(directory);controls.generate(out)
            capture=out/'native.json'
            capture.write_bytes(gzip.decompress((fixture/'native-api.json.gz').read_bytes()))
            reference=controls.record(out,capture,capture)
            self.assertEqual(reference,json.loads((fixture/'reference.json').read_bytes()))
            for name in reference['compressed']:
                self.assertEqual((out/name).read_bytes(),(fixture/name).read_bytes())

    def test_phase_docx_changes_only_authored_svg_coordinates(self):
        with TemporaryDirectory() as directory:
            out=Path(directory);generate(out)
            with ZipFile(BASE/'control.docx') as a,ZipFile(out/'control.docx') as b:
                self.assertEqual(set(a.namelist()),set(b.namelist()))
                self.assertEqual([n for n in a.namelist() if a.read(n)!=b.read(n)],['word/media/vector.svg'])
            old=json.loads((BASE/'cases.json').read_bytes());new=json.loads((out/'cases.json').read_bytes())
            for a,b in zip(old,new,strict=True):
                self.assertEqual(b['points'],[[x+1/16,y+1/16] for x,y in a['points']])
            source=(out/'control.docx').read_bytes();generate(out)
            self.assertEqual((out/'control.docx').read_bytes(),source)
            committed=controls.ROOT/'tests/fixtures/svg-cubic-phase'
            self.assertEqual(source,(committed/'control.docx').read_bytes())
            self.assertEqual((out/'cases.json').read_bytes(),(committed/'cases.json').read_bytes())


if __name__=='__main__':unittest.main()
