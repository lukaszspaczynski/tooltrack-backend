// Cutting the tool out of a catalogue photo without an AI service.
//
// The method is the one from the Qbrick labelling project (przytnij.py): on a
// product photo — tool on a plain light background — the object is simply
// everything that is not the background, and the background is everything
// light that touches the edge of the frame. No model, no API key, no waiting.
//
// planCutout below is pure — pixels in, a mask and a box out — and everything
// that touches an actual file goes through image-convert.ts.
//
// Two deliberate differences from the original. It floods the background in
// from the border instead of taking the largest dark blob, so a white sticker
// or a light label in the middle of a drill stays part of the tool rather than
// becoming a hole. And it writes real transparency instead of painting the
// background white, so the result sits on any page.
//
// It refuses rather than guesses. A photo taken on a workbench has no plain
// background to flood, and half a cut-out bench is worse than no cutout.

import { ImageConversionError, pngFromRgba, toRgba } from './image-convert'
import { t } from './i18n'

export type CutoutOptions = {
  // Largest share of the frame the object may cover. Above it there is nothing
  // to cut away — the photo is already a close-up.
  maxCoverage: number
  // Smallest share worth calling a tool. Below it the threshold found dust.
  minCoverage: number
  padding: number
  // Sum of R+G+B at or above which a pixel counts as background-light. 735 is
  // the Qbrick default: an average of 245 per channel.
  threshold: number
}

export const DEFAULT_CUTOUT_OPTIONS: CutoutOptions = {
  maxCoverage: 0.92,
  minCoverage: 0.005,
  padding: 6,
  threshold: 735,
}

// How much of the frame's edge has to be light before the photo is treated as
// having a plain background at all. Four fifths leaves room for a tool that
// runs off one side of the frame.
const MIN_LIGHT_BORDER = 0.8

export type CutoutBox = {
  height: number
  width: number
  x: number
  y: number
}

export type CutoutPlan =
  { box: CutoutBox; coverage: number; mask: Uint8Array; ok: true } | { ok: false; reason: string }

// Raised when the photo itself is unsuitable — not when anything is broken.
// The route answers 422 for it, which is a different thing from the 503 an
// unconfigured or failing AI service gets.
export class PhotoNotSuitableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoNotSuitableError'
  }
}

// The tunable parts arrive as arguments — from settings, or from whoever is
// standing in front of the cutout screen. A value that could not work (a
// threshold above pure white, where the whole frame would be background) falls
// back rather than producing a confusing refusal.
export function cutoutOptions(
  overrides: { padding?: number; threshold?: number } = {},
): CutoutOptions {
  return {
    ...DEFAULT_CUTOUT_OPTIONS,
    padding: whole(overrides.padding, 0, 200) ?? DEFAULT_CUTOUT_OPTIONS.padding,
    threshold: whole(overrides.threshold, 1, 765) ?? DEFAULT_CUTOUT_OPTIONS.threshold,
  }
}

function whole(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  return value >= min && value <= max ? value : undefined
}

// The whole decision, as a pure function over RGBA bytes. Everything that
// makes this testable without an image file lives here; jimp only decodes and
// encodes around it.
export function planCutout(
  pixels: Uint8Array,
  width: number,
  height: number,
  options: CutoutOptions = DEFAULT_CUTOUT_OPTIONS,
): CutoutPlan {
  const total = width * height
  if (total === 0 || pixels.length < total * 4) {
    return { ok: false, reason: t('Nie udało się odczytać pikseli zdjęcia') }
  }

  const light = lightMask(pixels, total, options.threshold)

  const border = borderLightShare(light, width, height)
  if (border < MIN_LIGHT_BORDER) {
    return {
      ok: false,
      reason: t(
        'To zdjęcie nie ma jednolitego jasnego tła — wycinanie bez AI zadziała tylko na zdjęciach katalogowych',
      ),
    }
  }

  // Background is light and connected to the edge of the frame. Anything light
  // that is enclosed by the tool is therefore not background.
  const background = floodBackground(light, width, height)

  const object = new Uint8Array(total)
  for (let i = 0; i < total; i += 1) object[i] = background[i] ? 0 : 1

  // Closing, as in the original: bridges the anti-aliased edge and small gaps
  // without swallowing the shape.
  const closed = erode(dilate(object, width, height, 2), width, height, 2)

  const { bestLabel, bestSize, labels } = largestComponent(closed, width, height)
  if (bestSize === 0) {
    return { ok: false, reason: t('Nie znaleziono narzędzia na tym zdjęciu') }
  }

  const coverage = bestSize / total
  if (coverage > options.maxCoverage) {
    return {
      ok: false,
      reason: t('Narzędzie wypełnia już całe zdjęcie — nie ma czego wycinać'),
    }
  }
  if (coverage < options.minCoverage) {
    return {
      ok: false,
      reason: t('Obiekt na zdjęciu jest za mały — sprawdź, czy to zdjęcie narzędzia'),
    }
  }

  const mask = new Uint8Array(total)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let i = 0; i < total; i += 1) {
    if (labels[i] !== bestLabel) continue
    mask[i] = 1
    const x = i % width
    const y = (i - x) / width
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const x0 = Math.max(minX - options.padding, 0)
  const y0 = Math.max(minY - options.padding, 0)
  const x1 = Math.min(maxX + options.padding, width - 1)
  const y1 = Math.min(maxY + options.padding, height - 1)

  return {
    box: { height: y1 - y0 + 1, width: x1 - x0 + 1, x: x0, y: y0 },
    coverage,
    mask,
    ok: true,
  }
}

export async function cutoutLocally(
  bytes: Uint8Array,
  overrides: { padding?: number; threshold?: number } = {},
): Promise<Uint8Array> {
  let source: Awaited<ReturnType<typeof toRgba>>
  try {
    source = await toRgba(bytes)
  } catch (error) {
    // A picture the decoder cannot read is a fact about the photo, not a fault
    // in the server, so it gets the same 422 as one with no plain background.
    throw new PhotoNotSuitableError(
      error instanceof ImageConversionError ? error.message : t('Nie udało się odczytać zdjęcia'),
    )
  }

  const { height, pixels, width } = source
  const plan = planCutout(pixels, width, height, cutoutOptions(overrides))
  if (!plan.ok) throw new PhotoNotSuitableError(plan.reason)

  // Transparent everywhere the mask is not: a fresh buffer is already zeroed,
  // so only the tool has to be written into it.
  const output = new Uint8Array(plan.box.width * plan.box.height * 4)

  for (let y = 0; y < plan.box.height; y += 1) {
    for (let x = 0; x < plan.box.width; x += 1) {
      const from = (plan.box.y + y) * width + (plan.box.x + x)
      if (!plan.mask[from]) continue

      const to = (y * plan.box.width + x) * 4
      output[to] = pixels[from * 4]
      output[to + 1] = pixels[from * 4 + 1]
      output[to + 2] = pixels[from * 4 + 2]
      output[to + 3] = 255
    }
  }

  return pngFromRgba(output, plan.box.width, plan.box.height)
}

function lightMask(pixels: Uint8Array, total: number, threshold: number): Uint8Array {
  const light = new Uint8Array(total)

  for (let i = 0; i < total; i += 1) {
    const p = i * 4
    // An already-transparent pixel is background whatever colour it carries:
    // a PNG cut out once before must not be read as a black object.
    if (pixels[p + 3] < 16) {
      light[i] = 1
      continue
    }
    light[i] = pixels[p] + pixels[p + 1] + pixels[p + 2] >= threshold ? 1 : 0
  }

  return light
}

function borderLightShare(light: Uint8Array, width: number, height: number): number {
  let seen = 0
  let bright = 0

  const count = (index: number) => {
    seen += 1
    bright += light[index]
  }

  for (let x = 0; x < width; x += 1) {
    count(x)
    if (height > 1) count((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    count(y * width)
    if (width > 1) count(y * width + width - 1)
  }

  return seen === 0 ? 0 : bright / seen
}

// Flood from every light pixel on the edge. Iterative with an explicit stack:
// a three-megapixel photo would blow the call stack in seconds with recursion.
function floodBackground(light: Uint8Array, width: number, height: number): Uint8Array {
  const total = width * height
  const background = new Uint8Array(total)
  const stack = new Int32Array(total)
  let top = 0

  const push = (index: number) => {
    if (background[index] || !light[index]) return
    background[index] = 1
    stack[top] = index
    top += 1
  }

  for (let x = 0; x < width; x += 1) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width)
    push(y * width + width - 1)
  }

  while (top > 0) {
    top -= 1
    const index = stack[top]
    const x = index % width
    const y = (index - x) / width

    if (x > 0) push(index - 1)
    if (x < width - 1) push(index + 1)
    if (y > 0) push(index - width)
    if (y < height - 1) push(index + width)
  }

  return background
}

// Dilate and erode are separable: a pass along the rows, then one down the
// columns, each over a sliding window sum. That keeps the 5×5 closing linear
// in the number of pixels rather than 25 reads each.
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return sweep(mask, width, height, radius, (sum) => (sum > 0 ? 1 : 0))
}

function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return sweep(mask, width, height, radius, (sum, window) => (sum === window ? 1 : 0))
}

function sweep(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  decide: (sum: number, window: number) => number,
): Uint8Array {
  const horizontal = new Uint8Array(mask.length)

  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const from = Math.max(x - radius, 0)
      const to = Math.min(x + radius, width - 1)
      let sum = 0
      for (let k = from; k <= to; k += 1) sum += mask[row + k]
      horizontal[row + x] = decide(sum, to - from + 1)
    }
  }

  const vertical = new Uint8Array(mask.length)

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const from = Math.max(y - radius, 0)
      const to = Math.min(y + radius, height - 1)
      let sum = 0
      for (let k = from; k <= to; k += 1) sum += horizontal[k * width + x]
      vertical[y * width + x] = decide(sum, to - from + 1)
    }
  }

  return vertical
}

// Eight-connected labelling. The largest component is the tool; a drill bit or
// a manufacturer's logo lying next to it in the frame is a smaller one and
// falls away.
function largestComponent(
  mask: Uint8Array,
  width: number,
  height: number,
): { bestLabel: number; bestSize: number; labels: Int32Array } {
  const total = width * height
  const labels = new Int32Array(total)
  const stack = new Int32Array(total)
  let label = 0
  let bestLabel = 0
  let bestSize = 0

  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || labels[start]) continue

    label += 1
    let size = 0
    let top = 0
    labels[start] = label
    stack[top] = start
    top += 1

    while (top > 0) {
      top -= 1
      const index = stack[top]
      size += 1
      const x = index % width
      const y = (index - x) / width

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const neighbour = ny * width + nx
          if (!mask[neighbour] || labels[neighbour]) continue
          labels[neighbour] = label
          stack[top] = neighbour
          top += 1
        }
      }
    }

    if (size > bestSize) {
      bestSize = size
      bestLabel = label
    }
  }

  return { bestLabel, bestSize, labels }
}
