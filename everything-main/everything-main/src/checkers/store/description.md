# Checkers — app store listing

The listing copy lives in [`../STORE_LISTING.md`](../STORE_LISTING.md): name,
tagline, short and long description, features, audience, keywords, category,
and the headline on each promotional asset. Keep it as the one source — this
file is only a signpost, so that a submission form and an asset never disagree
about what the app is.

This directory holds the images that listing references:

    screenshots/1920x1080/01-three-ways-to-play.png … 04-replay-every-move.png
    screenshots/1024x768/  (same four assets)
    screenshots/1080x2280/ (same four assets, portrait)

These are compositions rather than raw screenshots: a headline, a supporting
line, the brand lockup, and a window onto a real region of the running app in
its light theme, laid out on a brand-coloured canvas at the exact size each
store slot asks for. Regenerate them with `node tools/store-screenshots.mjs` —
see the header of that file for how the positions are staged and how the crops
are measured, and the "Regenerating images" section of the top-level
`README.md` for installing Playwright first.
