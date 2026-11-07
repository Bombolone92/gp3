# Packaged presentation fonts

The catalog supplies the official static regular, bold, italic and bold-italic
faces. DrawingML selects these styles with its bold/italic flags. Installed
families retain priority; the app downloads packaged faces only when needed.
Font loading never changes the presentation's font declarations or package.

`SOURCES.json` records the official Google Fonts download manifests, static TTF
URLs and SHA-256 hashes. The WOFF2 assets preserve every original font table byte
except the WOFF2 `head` lossless-compression flag and recalculated checksum.
Glyph, metric and shaping transforms are disabled. Character coverage, GPOS,
GSUB and licensing metadata are retained. The eight assets total 553,448 bytes.
The full OFL notices are in `public/THIRD_PARTY_NOTICES.txt`.

To reproduce the assets and generated `src/font-catalog.js`, install
`fonttools[woff]==4.65.0` and `brotli==1.2.0` in a separate build environment, then
run from the repository root:

```sh
python scripts/build-font-resources.py /path/to/font-download-cache
npx prettier --write src/font-catalog.js src/assets/fonts/SOURCES.json
```

The script downloads missing source files, validates their hashes, verifies the
compression and derives capabilities from the actual font tables. These Python
packages are build tools, not application dependencies.

## Kerning compatibility

Native reference controls distinguish static and variable faces:
static fonts use legacy `kern` data, while variable fonts use GPOS pair kerning.
Controlled fonts with identical glyphs/advances isolated direct, extension,
class, lookup-order and encoded-glyph cases. Conflicting GPOS/legacy pair values
confirmed the selection. An independent static CFF face confirmed the absence
of GPOS kerning. PDF font names were verified to exclude substituted controls.

The packaged static faces contain GPOS but no legacy `kern` table. Their native
pair kerning is therefore disabled by the font provider, based on table metadata
rather than family names. The renderer's `resolveFontKerning` callback applies
this to both measurement and painting after resolving OOXML thresholds. The
editor uses the same provider. Font-face descriptors alone are insufficient:
browser handling differs, so resolved kerning is also explicit on text.

Browsers without Canvas `fontKerning` use a temporary CSS probe to measure an
entire shaped run. This preserves ligatures and combining marks; widths retain
the existing bounded cache. The probe is always removed. Unknown and installed
fonts retain existing behavior. This catalog does not claim to model every
system font or conflicting legacy/GPOS font automatically.

Related specifications:

- [OpenType GPOS](https://learn.microsoft.com/en-us/typography/opentype/spec/gpos)
- [OFL webfont guidance](https://openfontlicense.org/ofl-faq/#2-using-ofl-fonts-for-webpages-and-online-webfont-services)
