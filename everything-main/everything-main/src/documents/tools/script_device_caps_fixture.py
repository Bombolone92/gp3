"""Original controls for independent validation of script device-bound caps."""
from pathlib import Path
import argparse
from script_vdmx_ppem_fixture import write_controls, perturb
from script_vdmx_fixture import with_vdmx
from script_position_metrics_fixture import build

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT/'tests/fixtures/script-device-caps'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=TARGET)
    target = parser.parse_args().output
    target.mkdir(parents=True, exist_ok=True)
    fonts, cases = [], []
    for value in [600, 650, 660, 665, 670, 675, 700, 850, 950]:
        family = f'Script Y Probe {value}'
        path = build(family, {'OS/2': {16: 700, 24: 700, 20: value}}, target)
        fonts.append(path.name)
        cases.append(dict(family=family, kind='superSize', value=value,
                          rows=[dict(size=20, script=s) for s in ['superscript', 'subscript']]))
    for delta in [0, 4, 8, 16, 32]:
        family = f'Script Bound Probe {delta}'
        path = build(family, {'OS/2': {16: 700, 24: 700}}, target)
        data = with_vdmx(path.read_bytes(), .95, .35)
        for _ in range(delta//4): data = perturb(data, 83)
        path.write_bytes(data); fonts.append(path.name)
        cases.append(dict(family=family, kind='ascentDelta', value=delta,
                          rows=[dict(size=10, script=s) for s in ['superscript', 'subscript']]))
    write_controls(target, cases, fonts)
    print('Authored 14 cap-validation fonts and 28 native script rows')


if __name__ == '__main__': main()
