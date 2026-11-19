<img src="assets/icon.svg" width="64" height="64" alt="">

# k-pond

An ASCII pond at night: frogs hop between drifting lily pads, ripples spread across the water, and fireflies wander past (sometimes too close to a frog).

Open `index.html` in a browser. There's no build step and nothing to install.

## Playing with it

There are no instructions on the page; the pond is meant to be discovered.

- **Click a frog** to make it hop.
- **Click a lily pad** to call the nearest frog over.
- **Click or drag on the water** to make ripples and spook nearby frogs.
- **Space** makes every frog jump at once.
- **`v`**, or the `v1 v2` switch in the corner, swaps drawing styles on the same pond so you can compare them.
- **Sun/moon** switches between night and day. It follows your system setting until you pick one, then remembers your choice.
- **Speaker** turns on synthesized plops, splashes and croaks.

Now and then a frog misses, lands in the water, and swims back to a pad.

## How it works

`pond.js` runs the pond: pads drift, frogs decide where to jump, and ripples spread. It knows nothing about drawing. Every frame it hands the same world to one of two renderers:

- **v1** (`render-v1.js`) draws a fine grid of coloured glyphs. Line glyphs (`- \ | /`) follow each edge's direction, so the outlines of rings and leaves stay clean.
- **v2** (`render-v2.js`) draws a coarser grid where each cell can hold a coloured tile and a glyph. The tiles carry shape and colour. The glyphs are inked in a darker shade of their own tile and add texture. Open water stays mostly empty apart from ripples and fading wakes. The tile-and-glyph style was inspired by the koi pond on [daoho.dev](https://www.daoho.dev/).

`common.js` holds the helpers both sides share. The files are plain scripts rather than modules, so the page works when opened straight from disk.

Created in [T3 Code](https://t3.codes).
