# Chess

**Play chess in your browser**

## Short description

Play chess free in your browser. Take on the computer at three levels, pass and
play on one device, or invite a friend to a private online game.

## Long description

Open it and make a move. Chess runs entirely in your browser, so there is
nothing to download and nothing to set up before the first game. Pick a side,
pick a clock, and play.

There are three ways to play. The computer plays at Easy, Medium, or Hard, so
there is a game whether you are learning how the pieces move or looking for a
real fight. Pass and play hands one device back and forth between two people.
Online play creates a private game you share with a code or a link, with resign
and rematch built in.

Every rule is enforced by a chess engine written for this app and checked
against reference test positions: castling, en passant, promotion, checkmate,
stalemate, threefold repetition, the fifty move rule, and insufficient material.
The clocks are just as careful. Time is charged from real timestamps rather than
counted down by a timer, so a tab left in the background never costs a player
more than it should, and the clock only starts once the first move is made.

When a game ends, you can go back through it. Step move by move with the arrow
keys, click any move to jump straight to that position, then copy the game as
PGN or download it as a file any chess program can read. A game in progress
against the computer or in pass and play is saved as you go, so a reload or a
closed tab picks up where you left off, clocks included.

Games against the computer and pass and play games run entirely on your device.
Online games connect the two players directly and are set up through a Puter
sign in.

## Key features

- Beat the computer at three difficulty levels, from an Easy that is kind to
  beginners to a Hard that punishes loose play.
- Play a friend on one device with pass and play, or send an invite code or link
  for a private online game, complete with resign and rematch.
- Set the clock you want: eight time controls from 1 + 0 bullet to 15 + 10
  rapid, with Fischer increments, or play with no limit at all.
- Move by click, tap, or drag, with legal move hints, last move and check
  highlights, and smooth animation.
- Follow the game in standard algebraic notation, with captured pieces and the
  material count next to each player.
- Pick up where you left off, because a game in progress is saved as you play
  and survives a reload or a closed tab.
- Replay any position by clicking a move or using the arrow keys, then copy or
  download the whole game as PGN.
- Play in light or dark, on a phone or a desktop, with settings that stick
  between visits.

## Who it's for

- Players who want a game in the time it takes to open a tab
- Beginners who want every rule checked while they learn
- Two people sharing a couch, or friends on opposite sides of the world
- Bullet and blitz players who want a real clock with increments
- Anyone who reviews their games afterwards and keeps the PGN

## Highlights in this version

- Chess clocks across bullet, blitz, and rapid, with Fischer increments.
  Running out of time loses the game, unless your opponent has no way to
  checkmate, in which case it is a draw.
- Games in progress now survive a reload, clocks and captured pieces included.
- Game review and export: step through a game, jump to any position, and copy or
  download it as PGN.

## Keywords

chess, play chess, chess online, chess vs computer, two player chess, pass and
play, chess with friends, blitz chess, bullet chess, chess clock, board game,
PGN, free chess

## Category

Games, Board. Suitable secondary placement: Puzzle and Strategy.

## Store assets

Four promotional images per size, in `store/screenshots/`. Regenerate them with
`npm run dev` and then `node tools/store-promo.mjs` (see the header of that file
for the details). Every asset uses the light theme.

| File | Feature |
| --- | --- |
| `01-play-the-computer.png` | Three difficulty levels, a clock, and a live move list |
| `02-play-a-friend-online.png` | A private online game, shared with a code or a link |
| `03-chess-clocks.png` | Bullet, blitz, and rapid time controls with increments |
| `04-review-and-export.png` | Stepping back through a finished game and exporting PGN |

Sizes: `1920x1080` (desktop, landscape), `1024x768` (tablet, landscape), and
`1080x2280` (mobile, portrait).
