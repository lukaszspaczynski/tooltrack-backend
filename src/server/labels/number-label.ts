// Template 1: the number.
//
// The shape comes from the stickers already on the shelf in the sibling Qbrick
// project: a rounded rectangle in the maker's colour, the ordinal number large
// at the top, the maker's name under it, and — when the box holds two makers —
// a wedge along the bottom in the second colour with that name in it.
//
// Everything is proportional to the label, because the same drawing has to work
// at 30 x 40 mm on a front and 200 x 60 mm on a lid.

import { rgb, type PDFImage, type RGB } from 'pdf-lib'

import {
  bottomWedgePath,
  CORNER,
  drawCentred,
  drawCutOutline,
  fitFontSize,
  MM,
  readableOn,
  roundedRectPath,
  startLabel,
  toRgb,
  type LabelPage,
} from './pdf'

export type NumberLabelBrand = {
  color: string
  logo: null | Uint8Array
  name: string
}

export type NumberLabelInput = {
  brands: NumberLabelBrand[]
  // The cut line is a guide, so it is drawn only on a file meant for scissors.
  cutLine: boolean
  heightMm: number
  number: number
  widthMm: number
  withLogos: boolean
}

// Shares of the label height. Read off the Qbrick stickers rather than chosen:
// a shelf of old and new labels has to look like one set.
const WEDGE_TOP_LEFT = 0.76
const WEDGE_TOP_RIGHT = 0.7

export async function drawNumberLabel(input: NumberLabelInput): Promise<Uint8Array> {
  const label = await startLabel(input.widthMm, input.heightMm)
  const brands = input.brands.length > 0 ? input.brands : [{ color: '', logo: null, name: '' }]
  const radius = Math.min(label.width, label.height) * CORNER

  const first = toRgb(brands[0].color)
  const ink = readableOn(first)

  label.page.drawSvgPath(roundedRectPath(label.width, label.height, radius), {
    color: first,
    x: 0,
    y: label.height,
  })

  // Two makers split the label; three or more share it in bands, because a
  // three-way diagonal is unreadable at 30 mm.
  const split = brands.length === 2
  const bandTop = split
    ? drawWedge(label, toRgb(brands[1].color), radius)
    : drawBands(
        label,
        brands.slice(1).map((brand) => toRgb(brand.color)),
        radius,
      )

  if (split) {
    // The lower of the two edges, so the mark stays inside the wedge on both
    // sides rather than crossing the seam on the left.
    await drawBrand(label, brands[1], {
      bottom: 0,
      logos: input.withLogos,
      top: label.height * (1 - WEDGE_TOP_LEFT),
    })
  }

  // A lid is 200 x 60 mm and a front is 30 x 40: stacking the number over the
  // maker suits the second and wastes the first, where the number ends up
  // twenty millimetres tall on a label three times that wide. Past twice as
  // wide as it is tall, the two stand side by side instead.
  const wide = label.width / label.height >= 2

  if (wide) {
    const area = { bottom: bandTop, top: label.height }
    await drawBrand(label, brands[0], {
      bottom: area.bottom,
      left: label.width * 0.45,
      logos: input.withLogos,
      right: label.width * 0.96,
      top: area.top,
    })
    drawNumber(label, input.number, ink, area.bottom, {
      left: label.width * 0.04,
      right: label.width * 0.45,
    })
  } else {
    const brandBlock = await drawBrand(label, brands[0], {
      bottom: bandTop,
      logos: input.withLogos,
      top: bandTop + label.height * 0.26,
    })
    drawNumber(label, input.number, ink, brandBlock)
  }
  drawCutOutline(label, radius)

  return label.doc.save()
}

// Returns the height the second colour claims, measured from the bottom.
function drawWedge(label: LabelPage, color: RGB, radius: number): number {
  const left = label.height * WEDGE_TOP_LEFT
  const right = label.height * WEDGE_TOP_RIGHT

  label.page.drawSvgPath(bottomWedgePath(label.width, label.height, radius, left, right), {
    color,
    x: 0,
    y: label.height,
  })

  // A light seam along the cut. Bosch navy against Bosch green is a contrast of
  // about 1.5:1, and at 30 mm the boundary disappears in print without it.
  label.page.drawLine({
    color: rgb(1, 1, 1),
    end: { x: label.width, y: label.height - right },
    start: { x: 0, y: label.height - left },
    thickness: Math.max(label.height * 0.006, 0.5),
  })

  return label.height - Math.min(left, right)
}

function drawBands(label: LabelPage, colors: RGB[], radius: number): number {
  if (colors.length === 0) return 0

  const band = (label.height * 0.34) / colors.length
  colors.forEach((color, index) => {
    const top = label.height - band * (colors.length - index)
    // The last band reaches the bottom, so it carries the rounded corners.
    const path =
      index === colors.length - 1
        ? bottomWedgePath(label.width, label.height, radius, top, top)
        : `M 0 ${top} L ${label.width} ${top} L ${label.width} ${top + band} L 0 ${top + band} Z`

    label.page.drawSvgPath(path, { color, x: 0, y: label.height })
  })

  return band * colors.length
}

type BrandArea = {
  bottom: number
  // Both default to the full width; a wide label hands over one side of it.
  left?: number
  logos: boolean
  right?: number
  top: number
}

// Who made what is in the box: the logo when there is one and it was asked
// for, otherwise the name as text. One or the other, never both — a mark that
// reads "Bosch Professional" above the words "Bosch Professional" says nothing
// twice and takes the room away from the number, which is the thing somebody
// reads from across a workshop.
//
// Returns the top of what was drawn, so the number knows where to stop.
async function drawBrand(
  label: LabelPage,
  brand: NumberLabelBrand,
  area: BrandArea,
): Promise<number> {
  const available = area.top - area.bottom
  if (available <= 0) return area.bottom

  const left = area.left ?? label.width * 0.07
  const right = area.right ?? label.width * 0.93
  const logo = area.logos ? brand.logo : null

  if (logo) {
    const padding = available * 0.12
    const drawn = await drawLogo(label, logo, {
      bottom: area.bottom + padding,
      height: available - padding * 2,
      left,
      right,
    })

    return area.bottom + padding + drawn
  }

  if (!brand.name) return area.bottom

  const ink = readableOn(toRgb(brand.color))
  const size = fitFontSize(brand.name, label.fonts.bold, available * 0.45, right - left)
  const textHeight = label.fonts.bold.heightAtSize(size, { descender: false })
  const baseline = area.bottom + (available - textHeight) * 0.45
  const width = label.fonts.bold.widthOfTextAtSize(brand.name, size)

  label.page.drawText(brand.name, {
    color: ink,
    font: label.fonts.bold,
    size,
    x: left + (right - left - width) / 2,
    y: baseline,
  })

  return baseline + textHeight
}

async function drawLogo(
  label: LabelPage,
  bytes: Uint8Array,
  area: { bottom: number; height: number; left?: number; right?: number },
): Promise<number> {
  const image: PDFImage = await label.doc.embedPng(bytes)
  const left = area.left ?? label.width * 0.07
  const right = area.right ?? label.width * 0.93
  const scale = Math.min((right - left) / image.width, area.height / image.height)

  label.page.drawImage(image, {
    height: image.height * scale,
    width: image.width * scale,
    x: left + (right - left - image.width * scale) / 2,
    y: area.bottom,
  })

  return image.height * scale
}

function drawNumber(
  label: LabelPage,
  value: number,
  ink: RGB,
  bottom: number,
  span?: { left: number; right: number },
): void {
  const text = String(value)
  const margin = Math.min(label.width, label.height) * 0.08
  const available = label.height - bottom - margin * 2
  if (available <= 0) return

  const left = span?.left ?? margin
  const right = span?.right ?? label.width - margin

  // Measured, not guessed: heightAtSize without the descender is the ink of a
  // row of digits, and a guessed cap-height ratio is how a "1" ends up touching
  // the top edge.
  const byWidth = fitFontSize(text, label.fonts.bold, label.height * 2, right - left)
  const perPoint = label.fonts.bold.heightAtSize(1, { descender: false })
  const size = Math.min(byWidth, available / perPoint)
  const inkHeight = label.fonts.bold.heightAtSize(size, { descender: false })
  const width = label.fonts.bold.widthOfTextAtSize(text, size)

  label.page.drawText(text, {
    color: ink,
    font: label.fonts.bold,
    size,
    x: left + (right - left - width) / 2,
    y: bottom + margin + (available - inkHeight) / 2,
  })
}

// Exported for the tests: the geometry is worth asserting without a PDF reader.
export const NUMBER_LABEL_MM = MM
export { drawLogo }
