"""Owned textless alpha controls that distinguish coverage byte rounding."""
import argparse
from pathlib import Path
from shadow_mask_antialias_fixture import build as build_controls


def build(folder):
    cases = [dict(name=f'square-72-blur-48-alpha-{alpha}', widthPt=72,
                  heightPt=72, blurPt=48, sourceAlpha=alpha, offsetPt=0,
                  color='000000', alpha=100000)
             for alpha in [1, 63, 65, 127, 129, 191, 193, 255]]
    return build_controls(folder, cases=cases)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(f'Authored {len(build(args.output))} precision controls')
