# ZenSand

A kinetic sand-art watchface for Pebble.

A steel ball rolls across a bed of sand, ploughing a groove behind it. The
path is a hypotrochoid (spirograph), so the accumulated grooves build up a
mandala over the course of each minute. On the minute the sand is smoothed
flat and the ball starts a new pattern — twelve patterns cycle, one per
minute.

The sand bed is the whole watch face: a disc as wide as the display, so on a
round screen it is the entire front and on a rectangular one a full-width
square centred in the screen. A graduated bezel carries the twelve hour
marks. Time is analogue — the hour and minute hands sweep over the sand,
each drawn with a halo of smoothed sand so they stay legible over the
grooves. The only digital element is a small date at six o'clock.

## Platforms

| Platform | Display | Watch |
| --- | --- | --- |
| `gabbro` | 260×260 round, colour | Pebble Time Round 2 |
| `chalk` | 180×180 round, colour | Pebble Time Round |
| `emery` | 200×228, colour | Pebble Time 2 |
| `diorite` | 144×168, b/w | Pebble 2 HR |
| `flint` | 144×168, b/w | Pebble 2 Duo |

## Notes

Grooves accumulate in an off-screen `GBitmap` (8-bit on colour platforms,
1-bit on black-and-white), so each frame only plots the short new arc and
blits the canvas rather than re-drawing thousands of points. All trigonometry
uses the integer `sin_lookup`/`cos_lookup` — there is no floating point.

The ball paces itself so each pattern completes exactly on the minute, and
opening the face mid-minute redraws the sand to the state it should already
be in. Animation runs at roughly 20fps, which costs more battery than a
static watchface.

This branch is a flat, single-project copy of `zensand/` from the development
branch, laid out at the repository root for CloudPebble to pull.
