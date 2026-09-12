// Turns a label into a sheet somebody can print and cut.
//
// The templates draw the sticker and nothing else. This wraps that page in a
// margin and puts the marks in it — outside the artwork, where they belong,
// because a crop mark printed on a sticker is a crop mark stuck to a toolbox.
//
// A plain label is the artwork alone: the right thing to embed, send or look
// at. A print-ready one is the same artwork with somewhere to aim the scissors.

import { PDFDocument, rgb } from 'pdf-lib'

import { MM } from './pdf'

// Enough room for a mark and a caption without wasting a sheet.
const MARGIN_MM = 6
const MARK_LENGTH_MM = 4
// The mark stops short of the trim so the line itself never touches the label.
const MARK_GAP_MM = 1.2

export async function addPrintMarks(
  label: Uint8Array,
  size: { heightMm: number; widthMm: number },
): Promise<Uint8Array> {
  const source = await PDFDocument.load(label)
  const doc = await PDFDocument.create()
  const [embedded] = await doc.embedPdf(source, [0])

  const margin = MARGIN_MM * MM
  const width = size.widthMm * MM
  const height = size.heightMm * MM
  const page = doc.addPage([width + margin * 2, height + margin * 2])

  page.drawPage(embedded, { height, width, x: margin, y: margin })

  drawCropMarks(page, { height, margin, width })
  drawScaleBar(doc, page, { height, margin, size, width })

  return doc.save()
}

type Geometry = { height: number; margin: number; width: number }

// Four corners, each two short lines pointing outwards. Together they say where
// the label ends without a single line crossing it.
function drawCropMarks(page: ReturnType<PDFDocument['addPage']>, geometry: Geometry): void {
  const { height, margin, width } = geometry
  const length = MARK_LENGTH_MM * MM
  const gap = MARK_GAP_MM * MM
  const ink = rgb(0.45, 0.45, 0.45)
  const thickness = 0.4

  const corners = [
    { x: margin, y: margin, dx: -1, dy: -1 },
    { x: margin + width, y: margin, dx: 1, dy: -1 },
    { x: margin, y: margin + height, dx: -1, dy: 1 },
    { x: margin + width, y: margin + height, dx: 1, dy: 1 },
  ]

  for (const corner of corners) {
    page.drawLine({
      color: ink,
      end: { x: corner.x + corner.dx * (gap + length), y: corner.y },
      start: { x: corner.x + corner.dx * gap, y: corner.y },
      thickness,
    })
    page.drawLine({
      color: ink,
      end: { x: corner.x, y: corner.y + corner.dy * (gap + length) },
      start: { x: corner.x, y: corner.y + corner.dy * gap },
      thickness,
    })
  }
}

// A measured bar along the bottom margin, with its length written next to it.
// Printers scale to fit by default, and a sticker printed at 96% fits nothing:
// measuring this bar is how somebody finds that out before cutting fifteen
// labels, not after.
async function drawScaleBar(
  doc: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  geometry: Geometry & { size: { heightMm: number; widthMm: number } },
): Promise<void> {
  const { margin, size, width } = geometry
  const font = await doc.embedFont('Helvetica')

  // As long as the label allows, in whole centimetres, never more than five.
  const barMm = Math.max(Math.min(Math.floor(size.widthMm / 10) * 10, 50), 10)
  const bar = barMm * MM
  const ink = rgb(0.45, 0.45, 0.45)
  const y = margin * 0.45
  const left = margin + (width - bar) / 2

  page.drawLine({
    color: ink,
    end: { x: left + bar, y },
    start: { x: left, y },
    thickness: 0.5,
  })

  for (const x of [left, left + bar]) {
    page.drawLine({ color: ink, end: { x, y: y + 1.2 * MM }, start: { x, y }, thickness: 0.5 })
  }

  const caption = `${barMm} mm · etykieta ${size.widthMm} × ${size.heightMm} mm`
  const fontSize = 5
  const captionWidth = font.widthOfTextAtSize(caption, fontSize)

  page.drawText(caption, {
    color: ink,
    font,
    size: fontSize,
    x: margin + (width - captionWidth) / 2,
    y: y + 1.9 * MM,
  })
}
