# Dependencies and licensing

## Test execution

- Run tests, browser checks, conformance checks, license checks and builds locally.


- Do not introduce AGPL-licensed code or dependencies (direct, transitive, vendored, or remotely loaded).
- Do not introduce proprietary third-party document engines, including in tests or tools.
- Every shipped binary must have available corresponding source and an acceptable license. Record provenance for vendored assets.
- Run `npm run check:licenses` after dependency changes. Do not expand the license allowlist merely to make a check pass; review the actual license first.
- The new engine in `src/engine` is original code. Do not translate or copy another engine's implementation into it.

# Canvas milestone

- Keep document mutations, DOCX serialization, layout, and painting separate.
- Preserve untouched DOCX package parts. Open documents with unsupported features on a best-effort basis. Use a read-only approximation when safe editing is unavailable, and do not attach a save handler that could discard unsupported content.
- Add meaningful round-trip and editing regressions for new engine behavior. Run unit tests, browser tests, and the production build.
- `playground.html` runs locally without a Puter account. Keep it available as the small engine evaluation surface.
- Older app-authored import/export helpers remain available for future porting; their presence does not mean the canvas engine supports those features.

# Specification and conformance

- For each editor feature, record the relevant ECMA-376/OOXML clauses and supported subset in `docs/conformance.md`.
- Add behavioral tests plus an independently generated DOCX fixture and validate browser exports with `npm run check:conformance`.
- Correct discrepancies found by the spec review before declaring the feature complete. Document remaining gaps explicitly; a schema pass is not full OOXML conformance or layout fidelity.
- Keep downloaded standards schemas in temporary test caches. Do not bundle another editor's source or a proprietary validator.
