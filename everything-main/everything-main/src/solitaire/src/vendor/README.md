# Vendored dependencies

## cardmeister.js

52 SVG playing cards plus a card back, as a `<playing-card>` custom element.

- Upstream: https://github.com/cardmeister/cardmeister.github.io
- License: The Unlicense (public domain)
- Artwork lineage: Adrian Kennard's CC0 cards (https://www.me.uk/cards/),
  optimised by Danny Engelman.

Vendored rather than installed from npm because it is a single self-contained
file with no dependencies and no active release cadence.

### Integration constraints, measured

- The SVG **preserves aspect ratio**. In a box that is not the card's native
  ratio it letterboxes rather than stretching. Keep card boxes at 1:1.4.
- `borderline="0"` does **not** suppress its own border. Set `bordercolor` to
  the card colour instead.
- Court cards are illegible below roughly 56px wide. This is why the game
  falls back to a plain corner-index card under 76px.
- The element renders itself by replacing its children with an `<img>` whose
  `src` is a `data:image/svg+xml,...` URI — there is no shadow DOM and no
  built-in sizing. Both the `<playing-card>` element and the `<img>` it
  contains must be styled `display: block; width: 100%; height: 100%;` or the
  art collapses to the image's default box instead of filling the card.
