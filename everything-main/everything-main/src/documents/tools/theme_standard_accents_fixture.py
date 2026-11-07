"""Original independent green/orange accent controls and one-byte neighbors.

Generated before native capture; imports no renderer or expected RGB values.
"""
from pathlib import Path
import argparse
from theme_minmax_neighbors_fixture import generate, ROOT

BASES = ['9BBB59', '9ABB59', '9BBA59', '9BBB58', 'F79646', 'F69646', 'F79546', 'F79645']
VALUES = [0, 1, 64, 99, 128, 153, 191, 254, 255]
NAME = 'theme-standard-accents-20261004.docx'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT/'tests/fixtures/theme-standard-accents')
    args = parser.parse_args()
    path, count = generate(args.output_dir, BASES, VALUES, NAME)
    print(path, count)
