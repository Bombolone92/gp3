# Solitaire — app store listing

The listing copy lives in [`../STORE_LISTING.md`](../STORE_LISTING.md): name,
tagline, short and long description, features, audience, keywords, category,
and the caption for each screenshot. Keep it as the one source — this file is
only a signpost, so that a submission form and a screenshot never disagree
about what the app is.

This directory holds the images that listing references:

    screenshots/1920x1080/01-fresh-deal.png, 02-mid-game.png,
                           03-win-cascade.png, 04-you-won.png
    screenshots/1024x768/  (same four scenes as 1920x1080)
    screenshots/1080x2280/ 01-fresh-deal.png, 02-mid-game.png,
                           03-win-cascade.png, 04-plain-cards-on-phones.png

Four scenes at three sizes, but the fourth scene is not the same one in
every folder: the phone-width board is honestly full-bleed only at the
1080x2280 folder's own narrow viewport, so at the two landscape sizes it's
replaced with the win overlay instead — a landscape frame showing that
deliberately narrow a layout is mostly empty felt, which reads as broken
rather than as a phone screenshot. See STORE_LISTING.md's screenshot table
and the header of `../tools/store-screenshots.mjs` for the full reasoning.
Regenerate them with
`node tools/store-screenshots.mjs` — see the header of that file for how the
positions are staged (through the app's own save format, not hand-drawn), and
the "Regenerating images" section of the top-level `README.md` for installing
Playwright first.
