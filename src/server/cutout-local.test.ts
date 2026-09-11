import assert from 'node:assert/strict'
import test from 'node:test'

import { cutoutOptionsFromEnv, DEFAULT_CUTOUT_OPTIONS, planCutout } from './cutout-local'

// A canvas of RGBA bytes, so every case below is a picture described in code
// rather than a binary fixture nobody can read in a diff.
function canvas(width: number, height: number, background = 255) {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = background
    pixels[i * 4 + 1] = background
    pixels[i * 4 + 2] = background
    pixels[i * 4 + 3] = 255
  }

  const paint = (x0: number, y0: number, w: number, h: number, value: number) => {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const p = (y * width + x) * 4
        pixels[p] = value
        pixels[p + 1] = value
        pixels[p + 2] = value
        pixels[p + 3] = 255
      }
    }
  }

  return { height, paint, pixels, width }
}

test('a dark tool on white is found and cropped to its outline', () => {
  const image = canvas(100, 100)
  image.paint(30, 40, 20, 10, 20)

  const plan = planCutout(image.pixels, image.width, image.height, {
    ...DEFAULT_CUTOUT_OPTIONS,
    padding: 0,
  })

  assert.ok(plan.ok)
  assert.deepEqual(plan.box, { height: 10, width: 20, x: 30, y: 40 })
  // The mask covers the object and nothing else.
  assert.equal(plan.mask[45 * 100 + 40], 1)
  assert.equal(plan.mask[10 * 100 + 10], 0)
})

test('padding grows the crop but stays inside the frame', () => {
  const image = canvas(60, 60)
  image.paint(2, 2, 10, 10, 0)

  const plan = planCutout(image.pixels, image.width, image.height, {
    ...DEFAULT_CUTOUT_OPTIONS,
    padding: 6,
  })

  assert.ok(plan.ok)
  // Would be -4 without the clamp.
  assert.deepEqual(plan.box, { height: 18, width: 18, x: 0, y: 0 })
})

test('only the largest object survives — the bits lying next to it do not', () => {
  const image = canvas(120, 120)
  image.paint(20, 20, 40, 40, 30) // the tool
  image.paint(90, 90, 8, 8, 30) // a drill bit in the corner of the frame

  const plan = planCutout(image.pixels, image.width, image.height, {
    ...DEFAULT_CUTOUT_OPTIONS,
    padding: 0,
  })

  assert.ok(plan.ok)
  assert.deepEqual(plan.box, { height: 40, width: 40, x: 20, y: 20 })
  assert.equal(plan.mask[93 * 120 + 93], 0)
})

test('a light label inside the tool stays part of the tool', () => {
  // This is the difference from the original method: the background is what
  // touches the edge, so an enclosed white patch is not background and does
  // not become a hole in the cutout.
  const image = canvas(100, 100)
  image.paint(30, 30, 40, 40, 20)
  image.paint(45, 45, 10, 10, 255)

  const plan = planCutout(image.pixels, image.width, image.height, {
    ...DEFAULT_CUTOUT_OPTIONS,
    padding: 0,
  })

  assert.ok(plan.ok)
  assert.equal(plan.mask[50 * 100 + 50], 1)
})

test('a photo without a plain light background is refused', () => {
  // A tool on a workbench: there is no background to flood in from the edge,
  // and half a cut-out bench is worse than no cutout.
  const image = canvas(80, 80, 90)
  image.paint(30, 30, 20, 20, 10)

  const plan = planCutout(image.pixels, image.width, image.height)

  assert.equal(plan.ok, false)
  assert.match(plan.ok ? '' : plan.reason, /jednolitego jasnego tła/)
})

test('a close-up with nothing to trim is refused', () => {
  const image = canvas(50, 50)
  image.paint(1, 1, 48, 48, 40)

  const plan = planCutout(image.pixels, image.width, image.height)

  assert.equal(plan.ok, false)
  assert.match(plan.ok ? '' : plan.reason, /wypełnia już całe zdjęcie/)
})

test('a speck of dust is not a tool', () => {
  const image = canvas(200, 200)
  image.paint(100, 100, 2, 2, 0)

  const plan = planCutout(image.pixels, image.width, image.height)

  assert.equal(plan.ok, false)
  assert.match(plan.ok ? '' : plan.reason, /za mały/)
})

test('an empty white frame is refused rather than cropped to nothing', () => {
  const image = canvas(40, 40)

  const plan = planCutout(image.pixels, image.width, image.height)

  assert.equal(plan.ok, false)
})

test('an already transparent background counts as background', () => {
  // A photo cut out once before must not read as a black object on black.
  const image = canvas(100, 100)
  for (let i = 0; i < 100 * 100; i += 1) image.pixels[i * 4 + 3] = 0
  image.paint(40, 40, 20, 20, 10)

  const plan = planCutout(image.pixels, image.width, image.height, {
    ...DEFAULT_CUTOUT_OPTIONS,
    padding: 0,
  })

  assert.ok(plan.ok)
  assert.deepEqual(plan.box, { height: 20, width: 20, x: 40, y: 40 })
})

test('a truncated pixel buffer is refused, not read past its end', () => {
  const plan = planCutout(new Uint8Array(10), 100, 100)

  assert.equal(plan.ok, false)
})

test('the threshold is the one knob, and a nonsense value falls back', (t) => {
  t.after(() => {
    delete process.env.TOOLTRACK_CUTOUT_THRESHOLD
  })

  assert.equal(cutoutOptionsFromEnv().threshold, DEFAULT_CUTOUT_OPTIONS.threshold)

  process.env.TOOLTRACK_CUTOUT_THRESHOLD = '700'
  assert.equal(cutoutOptionsFromEnv().threshold, 700)

  for (const bad of ['banany', '0', '-5', '800']) {
    process.env.TOOLTRACK_CUTOUT_THRESHOLD = bad
    assert.equal(cutoutOptionsFromEnv().threshold, DEFAULT_CUTOUT_OPTIONS.threshold, bad)
  }
})

test('a greyish background still works when the threshold is lowered', () => {
  const image = canvas(100, 100, 232)
  image.paint(40, 40, 20, 20, 30)

  // 232 * 3 = 696, so the default 735 reads the background as object.
  assert.equal(planCutout(image.pixels, image.width, image.height).ok, false)

  const plan = planCutout(image.pixels, image.width, image.height, {
    ...DEFAULT_CUTOUT_OPTIONS,
    padding: 0,
    threshold: 690,
  })
  assert.ok(plan.ok)
  assert.deepEqual(plan.box, { height: 20, width: 20, x: 40, y: 40 })
})
