# Aligned floating-table pagination edge controls

Eight six-part DOCX packages are manually authored by
`tools/aligned_floating_parity_holdout.py`, using our XML scaffold and Arial.
They contain no corpus content, artwork or font programs. Regenerate into a
fresh directory using `--output-directory`; do not replace an opened source.
Source packages and case manifests have been checked byte reproducible.

| Folder | Additional generator arguments | Native pages | Supported flow |
| --- | --- | --- | --- |
| restart-0 | `--numbering-restart 0` | 11 | yes |
| restart-1 | `--numbering-restart 1` | 11 | yes |
| restart-2 | `--numbering-restart 2` | 11 | yes |
| leading-first | `--leading-first` | 12 | yes |
| initial-1-restart-2 | `--numbering-restart 2 --initial-number 1` | 11 | yes |
| initial-2-restart-1 | `--numbering-restart 1 --initial-number 2` | 11 | yes |
| mirrored-margin | `--mirror-margins` | 11 | no, mirrored margins remain read-only |
| mirrored-page | `--mirror-margins --horizontal-anchor page` | 11 | no, mirrored margins remain read-only |

All other arguments use the default margin anchor, compatibility 15, 18 rows
per table and 108/108 twip exterior cell margins. The reference application confirms that
horizontal inside/outside side uses the document's initial page number plus
the first physical fragment ordinal. Later numbering restarts do not reset
that side. Initial zero must remain zero. A body paragraph before the first
table advances its first fragment; continuation fragments retain its X.

The original restart-2 manifest's physical-parity-only prediction was
disproved by native capture and is retained unchanged. The two separately
authored initial-number/restart controls distinguish that explanation from
using the current section's displayed page number. Native mirrored controls
are retained as counterexamples for future mirrored-margin work, not proof
that the currently unsupported importer/layout path works.

`reference.json` records declared Unicode text origins with source/PDF
hashes. Guarded capture preserved source bytes, Saved state, selection, view
and zoom. PDF FontFile references were excluded before metadata construction;
glyph-program fallbacks were rejected. Native PDF and EMF stay private.
No native glyph, border or full raster equivalence is claimed.
