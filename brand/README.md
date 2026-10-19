# Den Duty brand

Everything here is generated from one drawing by `npm run icons` (`scripts/brand.mjs`, with the characters rendered
from the app's own components by `scripts/avatars.mjs`). Change the drawing there, not the files here.

## Colors

| Name | Hex | Use |
| --- | --- | --- |
| Den orange | `#e8590c` | The icon tile, "Duty" in the wordmark, primary buttons |
| Deep orange | `#c2410c` | Pressed / hover on orange |
| Sun yellow | `#ffd43b` | The sun, "Duty" on dark backgrounds |
| Sun deep | `#fab005` | Sun accents |
| Raccoon grey | `#a3aab1` | Fur |
| Mask | `#262a2e` | The raccoon's mask |
| Ink | `#1c1f22` | Text on light backgrounds |
| Cream | `#fff9ec` | Light backgrounds, splash screen |

Type: a heavy rounded sans (Nunito Black, or Segoe UI / Arial Rounded as fallbacks). The SVG wordmarks use live text
with that font stack; use the PNGs where the font may not be installed.

## Which file where

| Need | File |
| --- | --- |
| The logo, any size | `logo/den-duty-logo.svg` (rounded tile) |
| Tiny sizes (16-32 px) | `logo/den-duty-logo-small.svg` or `logo/png/den-duty-16.png` / `-32.png` (fewer, fatter sun rays) |
| Square, no rounding (the OS rounds it) | `logo/den-duty-logo-square.svg` |
| PNG at a set size | `logo/png/den-duty-{16,24,32,48,64,96,128,180,192,256,512,1024}.png` |
| Browser tab | `favicon.ico` (16/32/48) |
| PWA | `app-icons/pwa/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` |
| iPhone / iPad home screen | `app-icons/apple/apple-touch-icon-180.png` |
| Android adaptive icon | `app-icons/android/adaptive-foreground.png` + `adaptive-background.png` (1024, safe zone respected) |
| Android legacy / Play Store | `app-icons/android/ic_launcher-*.png`, `play-store-512.png` |
| Windows app / shortcut | `app-icons/windows/den-duty.ico` (16-256) |
| Unraid Community Applications | `unraid/den-duty-unraid.png` (the template points here) |
| Wordmark on light | `wordmark/den-duty-wordmark-light.svg/.png` |
| Wordmark on dark | `wordmark/den-duty-wordmark-dark.svg/.png` |
| Logo + name, side by side | `wordmark/den-duty-lockup-horizontal-{light,dark}.svg/.png` |
| Logo + name, stacked | `wordmark/den-duty-lockup-stacked-{light,dark}.svg/.png` |
| GitHub social preview / README banner | `social-banner.png` (1280×640) |
| Dr. Bandit | `characters/dr-bandit.svg/.png` |
| Raccoon avatars | `characters/avatars/raccoon-*.svg/.png` (the 14 avatars kids can pick) |

"Light" files have dark text for light backgrounds; "dark" files have white text for dark backgrounds.

## Using it

- Keep the tile's rounded corners and some space around the logo (at least a quarter of its width).
- Don't recolor the raccoon, stretch the logo, or put the light wordmark on a dark background.
- The raccoon head matches Nighttime Ninja's mark on purpose: Den Duty is its daytime sibling.
