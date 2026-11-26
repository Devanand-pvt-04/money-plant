# Brand

## App icon (from 0.12.1)

**H6 · Variegated leaves**, Charcoal palette: a money plant vine with three real money plant (pothos) leaves. Each leaf is heart-shaped, with a notch at the stalk and a pointed tip, two-tone like a marbled leaf, and carries a coin ring. It grew out of H3 (Coin-marked leaves). It shows a money plant without naming a currency. The app handles many currencies (decision 0017), so no logo, icon or thumbnail uses a currency symbol.

| Token | Hex | Use |
| --- | --- | --- |
| Ground (Charcoal) | `#1D1F1E` | Icon background, adaptive icon and splash background |
| Vine | `#6F9A6C` | Stem, stalks, the darker half of each leaf |
| Leaf | `#B3D3AC` | Leaves |

Coin rings are cut out of the leaves: they're painted in the ground colour, and in the themed (monochrome) icon they're transparent.

## Files

- `apps/mobile/assets/brand/mark.svg`: the mark on the 108 × 108 adaptive-icon grid. All PNGs are made from it.
- `apps/mobile/assets/icon.png`, `android-icon-*.png`, `splash-icon.png`, `favicon.png`: what `app.json` uses.
- `apps/mobile/assets/brand/thumbnail.png`: 1024 × 500 share and store thumbnail with the wordmark.

The glyph stays inside the adaptive icon's 66 dp safe circle, so launcher masks never clip it.

## Earlier options

The 2026-11 redesign drew 24 concepts and then four takes on each of six of them. All of them can serve as starting points for later changes:

- Canvas: https://claude.ai/artifact/NwWkAZ8cvtKdPoYtqEsy1f (pages "Round 1", "Round 2" and "Round 3")
- Source: project files `branding/icon-concepts-2026-11/` (`Mark.dc.html` holds every concept's SVG, ids `a`–`x`, `a1`–`i4` and `h5`–`h8`), plus the PNG render scripts in `branding/render-h3/` (`leaves.py` draws H5–H8)
