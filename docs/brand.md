# Brand

## App icon (from 0.12.2)

**G7 · Three tones, ground and trend**, Charcoal palette: three rounded bars rising in three greens, standing on a ground line, with a dotted rising trend line. The tallest bar sprouts two veined leaves, so your money grows like a plant. It grew out of G1 (Pill bars). The app handles many currencies (decision 0017), so no logo, icon or thumbnail uses a currency symbol. 0.12.1 shipped H6 (Variegated leaves), which is still kept with the other concepts.

| Token | Hex | Use |
| --- | --- | --- |
| Ground (Charcoal) | `#1D1F1E` | Icon background, adaptive icon and splash background |
| Dark green | `#6F9A6C` | First bar, ground line |
| Mid green | `#8FB98A` | Second bar |
| Light green | `#B3D3AC` | Tallest bar, leaves, trend line, bar highlights |

The leaf veins are cut out: they're painted in the ground colour, and in the themed (monochrome) icon they're transparent.

## Files

- `apps/mobile/assets/brand/mark.svg`: the mark on the 108 × 108 adaptive-icon grid. All PNGs are made from it.
- `apps/mobile/assets/icon.png`, `android-icon-*.png`, `splash-icon.png`, `favicon.png`: what `app.json` uses.
- `apps/mobile/assets/brand/thumbnail.png`: 1024 × 500 share and store thumbnail with the wordmark.

The glyph stays inside the adaptive icon's 66 dp safe circle, so launcher masks never clip it.

## Earlier options

The 2026-11 redesign drew 24 concepts and then four takes on each of six of them. All of them can serve as starting points for later changes:

- Canvas: https://claude.ai/artifact/NwWkAZ8cvtKdPoYtqEsy1f (pages "Round 1", "Round 2", "Round 3" and "Round 4")
- Source: project files `branding/icon-concepts-2026-11/` (`Mark.dc.html` holds every concept's SVG, ids `a`–`x`, `a1`–`i4`, `h5`–`h8` and `g5`–`g8`), plus the PNG render scripts in `branding/render-h3/` (`leaves.py` draws H5–H8, `bars.py` draws G5–G8; `ICON=g7 ./build.sh` renders every asset)

## Widget picker previews

`apps/mobile/assets/widget-preview/` has one image per widget (This month, Quick add, Coming up), which Android shows in the widget picker (`previewImage` in `app.json`). Each one draws the widget's real layout in the hero colours with sample numbers and no currency symbol. They're made by `branding/widget-preview-make.py` in the project files.
