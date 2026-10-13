# Lowtide brand guide

<p>
  <img src="brand/lowtide-mark.svg" alt="The Lowtide mark" width="96" />
  &nbsp;&nbsp;
  <img src="brand/lowtide-lockup.svg" alt="The Lowtide logo" height="56" />
</p>

## The idea

Every balance has tides. Paychecks lift it; rent, bills and the card pull it down. The **low tide** is the lowest point the balance will reach before the next paycheck, and whatever sits above the reserve at that moment is what you can safely spend.

The mark is a **moonrise**: a blue moon coming up over the water line. The moon pulls the tide, and Lowtide is the one that sees it coming.

## Name

- Written **Lowtide**: one word, capital L. Never "LowTide", "Low Tide" or "LOWTIDE" in running text.
- The wordmark in the logo is lowercase, **lowtide**, set in Geist at weight 640 with tight tracking and outlined, so it renders the same everywhere.

## Lines

| Use | Line |
|---|---|
| Tagline | **Know what's safe to spend.** |
| Descriptor | A day-by-day forecast of your balance, built for paychecks that change. |
| Story line | See your low tide before it comes. |
| One sentence | Lowtide forecasts your balance every day until your next paycheck, finds the lowest point and tells you what you can spend without touching your reserve. |

## Logo

| Asset | File | Use |
|---|---|---|
| Mark | [`brand/lowtide-mark.svg`](brand/lowtide-mark.svg) | 40 px and up: app icon, splash, documents |
| Compact mark | [`brand/lowtide-mark-compact.svg`](brand/lowtide-mark-compact.svg) | 16 to 32 px: favicon, the app header. A bigger moon and one wave, so it stays sharp |
| Logo, light | [`brand/lowtide-lockup.svg`](brand/lowtide-lockup.svg) | On light backgrounds |
| Logo, dark | [`brand/lowtide-lockup-dark.svg`](brand/lowtide-lockup-dark.svg) | On dark backgrounds |

- **Clear space:** keep at least a quarter of the mark's height free on every side.
- **Smallest sizes:** the mark at 40 px, the compact mark at 16 px, the logo at 24 px tall.
- **Don't** stretch it, rotate it, recolor the moon, outline it, add effects, or place it on a busy photo. The mark always sits on its own night tile.

Everything is drawn once in [`shared/brand/mark.ts`](../shared/brand/mark.ts). `node scripts/brand.ts` regenerates these files, the favicon, the app icons and the link previews from it.

## Color

The app's palette, with the night colors of the mark.

| Name | Hex | Use |
|---|---|---|
| Ink | `#0c0c0b` | Text and primary buttons on light surfaces |
| Plane | `#f5f5f1` | The app's light background (warm, never pure white) |
| Surface | `#ffffff` | Cards on light |
| Night | `#0a0a0a` → `#1f2a3a` | Dark background, the mark's tile, the landing page |
| Tide blue | `#2a78d6` | The one accent: links, charts, the moon's base |
| Tide bright | `#4b93ea` | The accent on dark backgrounds |
| Moonlight | `#9cc8f7` | Highlights, the top of the moon |
| Good / warning / critical | `#12a150` / `#f2a516` / `#d63c3c` | State only (paid, near a limit, over), always with an icon or words |

One accent only. Status colors never decorate.

## Type

- **Geist** for everything: interface, headlines, numbers. Weights 400 (body), 500 (labels), 600 (emphasis), 640 to 660 (headlines and the wordmark).
- Headlines are set tight (−0.03 to −0.05 em). Numbers use tabular figures so columns line up.
- **Geist Mono** only for code and rule patterns.

## Voice

Money is stressful; Lowtide is calm.

- **Plain and specific.** "About $33 a day until the Oct 20 paycheck", not "You're doing great!".
- **Numbers first,** then the one thing worth knowing.
- **Honest about the forecast.** It is a forecast: say what it assumes, and never promise more than it knows.
- **Second person, active voice, no exclamation marks,** no hype words ("seamless", "unleash", "revolutionary"), no fear ("Danger!").
- **Short.** If a sentence can lose a word, it does.

| Instead of | Write |
|---|---|
| Oops! Something went wrong. | This screen didn't load. Try again. |
| You're over budget!! | $12 over budget |
| Unlock powerful insights | See your low tide before it comes |

## Motion

Calm and rising, like the tide: elements arrive with a short fade and lift (about 200 to 400 ms, ease-out), the moon rises once on the splash, the water drifts slowly. Every animation respects the system's reduced-motion setting, and nothing important ever depends on one.
