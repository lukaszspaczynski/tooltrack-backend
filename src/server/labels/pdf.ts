// The shared half of every label: the page, the fonts, and the few drawing
// helpers the templates need.
//
// A label is one page exactly the size of the sticker, with a thin outline to
// cut along. Sheets that gang many labels onto A4 are a different job and not
// this one.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'

// PDF units are points: 72 to the inch, 25.4 mm to the inch.
export const MM = 72 / 25.4

// The fourteen fonts every reader has are WinAnsi, which has no ł, ą or ę. A
// label carrying a Polish tool name has to bring its own — see
// assets/fonts/README.md.
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts')

export type LabelFonts = {
  bold: PDFFont
  regular: PDFFont
}

export type LabelPage = {
  doc: PDFDocument
  fonts: LabelFonts
  height: number
  page: PDFPage
  width: number
}

// Two files of about seven hundred kilobytes each, read once for the life of
// the process rather than once per label: a sheet of two hundred embeds fonts
// two hundred times, and reading the same bytes off the disk four hundred times
// is seconds of a sheet's render spent on nothing. The bytes are only the
// input to `embedFont` — every document still gets its own subset.
const fontBytes = new Map<string, Promise<Uint8Array>>()

function loadFont(file: string): Promise<Uint8Array> {
  const cached = fontBytes.get(file)
  if (cached) return cached

  const reading = readFile(join(FONT_DIR, file))
  fontBytes.set(file, reading)

  return reading
}

// The same two faces in any document that has to say something in Polish —
// the sheet that gangs labels onto A4 needs them as much as a label does.
export async function embedLabelFonts(doc: PDFDocument): Promise<LabelFonts> {
  doc.registerFontkit(fontkit)

  const [regular, bold] = await Promise.all([
    doc.embedFont(await loadFont('DejaVuSans.ttf'), { subset: true }),
    doc.embedFont(await loadFont('DejaVuSans-Bold.ttf'), { subset: true }),
  ])

  return { bold, regular }
}

export async function startLabel(widthMm: number, heightMm: number): Promise<LabelPage> {
  const doc = await PDFDocument.create()
  const fonts = await embedLabelFonts(doc)

  const width = widthMm * MM
  const height = heightMm * MM
  const page = doc.addPage([width, height])

  return { doc, fonts, height, page, width }
}

// The cut line, drawn last so nothing covers it. Hairline and grey rather than
// black: it is a guide for scissors, not part of the design. A radius follows
// the label's own corners, because cutting a rounded sticker along a square
// line is how the corners end up lifting.
export function drawCutOutline(label: LabelPage, radius = 0): void {
  if (radius <= 0) {
    label.page.drawRectangle({
      borderColor: rgb(0.75, 0.75, 0.75),
      borderWidth: 0.4,
      height: label.height,
      width: label.width,
      x: 0,
      y: 0,
    })
    return
  }

  label.page.drawSvgPath(roundedRectPath(label.width, label.height, radius), {
    borderColor: rgb(0.75, 0.75, 0.75),
    borderWidth: 0.4,
    x: 0,
    y: label.height,
  })
}

// '#rrggbb' as pdf-lib wants it. Anything unparseable is white, because a
// label with no colour still has to print.
export function toRgb(color: string): RGB {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim())
  if (!match) return rgb(1, 1, 1)

  return rgb(
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  )
}

// Black or white, whichever can be read on this background. The coefficients
// are the sRGB luminance ones.
export function readableOn(color: RGB): RGB {
  const luminance = 0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue
  return luminance > 0.55 ? rgb(0, 0, 0) : rgb(1, 1, 1)
}

// The largest size at which this text fits the given width, never above the
// size asked for. A label is small and the names on it are not: shrinking to
// fit is the normal case, not the exception.
export function fitFontSize(
  text: string,
  font: PDFFont,
  maxSize: number,
  maxWidth: number,
): number {
  if (!text) return maxSize

  const atMax = font.widthOfTextAtSize(text, maxSize)
  if (atMax <= maxWidth) return maxSize

  return Math.max((maxSize * maxWidth) / atMax, 1)
}

export function drawCentred(
  label: LabelPage,
  text: string,
  options: { color: RGB; font: PDFFont; size: number; y: number },
): void {
  const width = options.font.widthOfTextAtSize(text, options.size)

  label.page.drawText(text, {
    color: options.color,
    font: options.font,
    size: options.size,
    x: (label.width - width) / 2,
    y: options.y,
  })
}

// Breaks text into lines that fit. A single word wider than the label is left
// on its own line rather than looping: the caller has already shrunk the size
// as far as it should go.
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate
      continue
    }
    lines.push(line)
    line = word
  }

  if (line) lines.push(line)
  return lines
}

// The corner radius every sticker shares, as a share of its shorter side. Both
// templates draw it, and a shelf where one label is rounder than the next looks
// like two batches.
export const CORNER = 0.075

// Rounded corners, as an SVG path in the y-down space drawSvgPath uses when it
// is anchored at the top of the page. pdf-lib's drawRectangle has no radius,
// and a sticker with square corners lifts at them.
//
// The 0.5523 is the usual circle-from-cubics constant: four curves at that
// handle length are within a thousandth of a true quarter circle.
const KAPPA = 0.5523

export function roundedRectPath(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2)
  const k = r * KAPPA

  return [
    `M ${r} 0`,
    `L ${width - r} 0`,
    `C ${width - r + k} 0 ${width} ${r - k} ${width} ${r}`,
    `L ${width} ${height - r}`,
    `C ${width} ${height - r + k} ${width - r + k} ${height} ${width - r} ${height}`,
    `L ${r} ${height}`,
    `C ${r - k} ${height} 0 ${height - r + k} 0 ${height - r}`,
    `L 0 ${r}`,
    `C 0 ${r - k} ${r - k} 0 ${r} 0`,
    'Z',
  ].join(' ')
}

// The band along the bottom, cut by a line that rises from left to right, with
// the same rounded corners as the label it sits in. Distances are from the top,
// like the path above.
export function bottomWedgePath(
  width: number,
  height: number,
  radius: number,
  topLeft: number,
  topRight: number,
): string {
  const r = Math.min(radius, width / 2, height / 2)
  const k = r * KAPPA

  return [
    `M 0 ${topLeft}`,
    `L ${width} ${topRight}`,
    `L ${width} ${height - r}`,
    `C ${width} ${height - r + k} ${width - r + k} ${height} ${width - r} ${height}`,
    `L ${r} ${height}`,
    `C ${r - k} ${height} 0 ${height - r + k} 0 ${height - r}`,
    'Z',
  ].join(' ')
}
