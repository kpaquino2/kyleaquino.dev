<img src="assets/icon.svg" width="64" height="64" alt="">

# k-pond

An ASCII pond at night: frogs hop between drifting lily pads, ripples spread across the water, and fireflies wander past (sometimes too close to a frog).

Open `index.html` in a browser. There's no build step and nothing to install.

## Playing with it

- **Click a frog** to make it hop.
- **Click a lily pad** to call the nearest frog over.
- **Click or drag on the water** to make ripples and spook nearby frogs.
- **Space** (or the `leap` button) makes every frog jump at once.
- **sound** turns on synthesized plops, splashes and croaks.
- **night / day** switches between the dark pond and a light, daytime one. It follows your system setting until you pick one, then remembers your choice.

Now and then a frog misses, lands in the water, and swims back to a pad.

## How it works

`pond.js` draws the scene into a character grid every frame. The water is layered sine waves plus value noise. The pads, flowers and frogs are shapes checked against the centre of each cell. Line glyphs (`- \ | /`) follow each edge's direction, so the outlines of rings and leaves stay clean. Each row is then drawn to a canvas as one text run per colour, which keeps it fast at full-screen sizes.

Created in [T3 Code](https://t3.codes).
