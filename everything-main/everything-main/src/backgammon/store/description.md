# Backgammon — app store listing

The listing copy lives in [`../STORE_LISTING.md`](../STORE_LISTING.md): name,
tagline, short and long description, features, audience, keywords, category,
and the headline for each screenshot. Keep it as the one source, so that a
submission form and a screenshot never disagree about what the app is.

This directory holds the images that listing references:

    screenshots/1920x1080/01-play-the-computer.png … 04-review-and-export.png
    screenshots/1024x768/   (the same four scenes)
    screenshots/1080x2280/  (the same four scenes, portrait)

Four scenes at three sizes, light theme only, whatever the machine building
them prefers. Regenerate the lot with:

```sh
npm run shots
```

## How they are made

They are not hand-taken screenshots, and nothing in them is a mock-up of the
interface. `tools/store-shots/` serves the real app to headless Chrome, seeds
it with a real game, drives it with real clicks, photographs it, and lays those
pictures into the promotional canvas. Three things are worth knowing:

**The boards are real games.** `positions.mjs` plays the computer opponent
against itself through the real engine, off a seeded generator, and keeps the
first position that passes a filter for the scene: both sides developed and the
race close for the opening shot, White far enough ahead to be turning the cube
for the second, a long game with checkers coming off for the fourth. The same
boards come back every run, and none of them is a position that could not have
happened. The result is fed in as a saved game, so the app restores it the way
it restores yours.

**The sizes are exact.** `Emulation.setDeviceMetricsOverride` sets the capture
size directly, so a 1080x2280 portrait canvas needs no 2280px-tall display to
render it, and the machine taking the shot cannot leak into the file.

**Two things stand in for the world outside the app.** The Puter peer API is
stubbed, so photographing the invite panel does not open a session on a live
service — the panel and the invite code are the app's own, only the code behind
them is not. And the doubling cube's take-or-drop card is shot on its own and
composited back over the board, because the app blurs everything behind an open
dialog and a whole asset built on a blurred screenshot reads as a bad
photograph. The card lands on a seam in the layout, measured from the page, so
it never slices a control in half.

## Requirements

Node, the project's own dependencies (`npm install`), and Google Chrome. No
ImageMagick and no design tool: the canvas is a page, and Chrome renders it.
Set `$CHROME` if Chrome is somewhere the script does not look.
