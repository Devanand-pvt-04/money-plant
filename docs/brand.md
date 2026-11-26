# Brand

## App icon (from 0.12.1)

**H3 · Coin-marked leaves**: a money plant vine whose three heart-shaped leaves each carry a coin ring. It shows a money plant without naming a currency. The app handles many currencies (decision 0017), so no logo, icon or thumbnail uses a currency symbol.

| Token | Hex | Use |
| --- | --- | --- |
| Ground | `#161816` | Icon background, adaptive icon and splash background |
| Vine | `#B8913A` | Stem |
| Leaf | `#E6CC85` | Leaves |

Coin rings are cut out of the leaves: they're painted in the ground colour, and in the themed (monochrome) icon they're transparent.

## Files

- `apps/mobile/assets/brand/mark.svg`: the mark on the 108 × 108 adaptive-icon grid. All PNGs are made from it.
- `apps/mobile/assets/icon.png`, `android-icon-*.png`, `splash-icon.png`, `favicon.png`: what `app.json` uses.
- `apps/mobile/assets/brand/thumbnail.png`: 1024 × 500 share and store thumbnail with the wordmark.

The glyph stays inside the adaptive icon's 66 dp safe circle, so launcher masks never clip it.

## Earlier options

The 2026-11 redesign drew 24 concepts and then four takes on each of six of them. All of them can serve as starting points for later changes:

- Canvas: https://claude.ai/artifact/NwWkAZ8cvtKdPoYtqEsy1f (pages "Round 1" and "Round 2")
- Source: project files `branding/icon-concepts-2026-11/` (`Mark.dc.html` holds every concept's SVG, ids `a`–`x` and `a1`–`i4`)
