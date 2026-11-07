Original descriptor fixtures generated with **psd-tools 1.23.0 (MIT)**.
`generate.py` reproduces all files without proprietary assets or the application
codec. They vary omitted/explicit defaults, fractional scale/angle/phase,
Unicode identity, independent alignment/link flags and malformed values.
Both `PtFl` and `vscg` PSD inputs contain independently encoded descriptors.
`validate.py` checks the browser regression's exported PSD/PSB files with the
independent decoder, including actual descriptor value types and signed zero.

These fixtures verify descriptor interoperability. They do not establish
how other applications render, transform or color-manage pattern fills.
