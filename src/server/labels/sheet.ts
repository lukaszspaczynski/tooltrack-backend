// Many labels on one sheet of A4, for the afternoon somebody prints a batch.
//
// The per-label file wraps one sticker in a margin with crop marks around it;
// that is the right file to print one of, and the wrong one to print thirty of
// — thirty margins is most of a sheet of paper. This puts the artwork alone,
// side by side, with a hairline where the scissors go and a measured ruler at
// the foot of every page, because a printer that scales to fit ruins a whole
// sheet at once rather than one label.
//
// Where things go is `sheet-layout.ts` and nothing here decides it.

import { degrees, PDFDocument, rgb, type PDFEmbeddedPage, type PDFPage } from 'pdf-lib'

import { embedLabelFonts, MM, type LabelFonts } from './pdf'
import {
  BOTTOM_MM,
  layoutSheet,
  MARGIN_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  type SheetSize,
} from './sheet-layout'

export type SheetLabel = SheetSize & {
  // The artwork alone — a label drawn with `printReady: false`. A print-ready
  // page would bring its own margin and its own crop marks onto a sheet that
  // already has both.
  artwork: Uint8Array
}

export type LabelSheet = {
  bytes: Uint8Array
  pages: number
  // Labels the paper could not hold, by their place in the list handed in.
  skipped: number[]
}

// Qbrick's TEXT_NAVY, the same ink the labels are drawn with.
const INK = rgb(0.043, 0.145, 0.29)
const FAINT = rgb(0.42, 0.42, 0.45)
// The line to cut along: a hairline, and grey rather than black, because it is
// a guide for scissors and not part of any sticker.
const CUT = rgb(0.75, 0.75, 0.75)
// What is missing is said in ink somebody notices: a sheet short of six labels
// looks exactly like a complete one once it is on paper.
const WARN = rgb(0.62, 0.16, 0.11)
const RULER_MM = 100

// How many artworks are parsed at once. Each one is a whole PDFDocument in
// memory beside the bytes it was loaded from, and a contents label carries up
// to six photographs — two hundred of them read in one breath is the way this
// runs a container out of memory rather than the way it goes faster.
const EMBED_AT_ONCE = 8

export async function buildLabelSheet(
  labels: SheetLabel[],
  title: string,
  // What the caller could not hand over — labels whose pictures have gone
  // missing, say. Written on every page beside what this function finds out
  // for itself, because the sheet is the only thing the person printing sees.
  notes: string[] = [],
): Promise<LabelSheet> {
  const layout = layoutSheet(labels)
  const doc = await PDFDocument.create()
  const fonts = await embedLabelFonts(doc)

  const pages: PDFPage[] = []
  for (let index = 0; index < layout.pages; index += 1) {
    pages.push(doc.addPage([PAGE_WIDTH_MM * MM, PAGE_HEIGHT_MM * MM]))
  }

  // Every artwork embedded once: pdf-lib copies the page and its resources, and
  // a label drawn twice on the sheet is the same picture twice. A few at a
  // time rather than all of them, so a sheet of two hundred does not hold two
  // hundred parsed documents at its peak.
  const embedded: PDFEmbeddedPage[] = []
  for (let start = 0; start < layout.placements.length; start += EMBED_AT_ONCE) {
    const chunk = layout.placements.slice(start, start + EMBED_AT_ONCE)
    embedded.push(
      ...(await Promise.all(
        chunk.map(async (placement) => {
          const source = await PDFDocument.load(labels[placement.index].artwork)
          const [page] = await doc.embedPdf(source, [0])
          return page
        }),
      )),
    )
  }

  layout.placements.forEach((placement, order) => {
    const page = pages[placement.page]
    const artwork = embedded[order]
    const label = labels[placement.index]
    const width = label.widthMm * MM
    const height = label.heightMm * MM

    // Rotation turns the page about the corner it is anchored at, so the
    // anchor moves to the far side of the footprint: a quarter turn puts the
    // artwork's own width up the page.
    page.drawPage(artwork, {
      height,
      rotate: placement.rotated ? degrees(90) : degrees(0),
      width,
      x: (placement.xMm + (placement.rotated ? placement.widthMm : 0)) * MM,
      y: placement.yMm * MM,
    })

    page.drawRectangle({
      borderColor: CUT,
      borderWidth: 0.25,
      height: placement.heightMm * MM,
      width: placement.widthMm * MM,
      x: placement.xMm * MM,
      y: placement.yMm * MM,
    })
  })

  // A label the paper cannot hold is not on the sheet, and the sheet has to say
  // so: at fifty a missing sticker was countable by eye, at two hundred it is
  // not.
  const warnings = [...notes]
  if (layout.skipped.length > 0) {
    warnings.push(`nie mieści się na arkuszu: ${layout.skipped.length}`)
  }

  pages.forEach((page, index) => {
    drawHeader(page, fonts, title, index + 1, pages.length, warnings)
    drawRuler(page, fonts)
  })

  return { bytes: await doc.save(), pages: layout.pages, skipped: layout.skipped }
}

// The title, what to tell the printer, and which page this is. The instruction
// is not decoration: "fit to page" is the default in most print dialogs and it
// is the one setting that makes every label on the sheet the wrong size.
function drawHeader(
  page: PDFPage,
  fonts: LabelFonts,
  title: string,
  number: number,
  total: number,
  warnings: string[],
): void {
  page.drawText(title, {
    color: INK,
    font: fonts.bold,
    size: 10,
    x: MARGIN_MM * MM,
    y: (PAGE_HEIGHT_MM - 11) * MM,
  })

  page.drawText('Drukuj w skali 100%, bez dopasowania do strony. Tnij po szarych ramkach.', {
    color: FAINT,
    font: fonts.regular,
    size: 7,
    x: MARGIN_MM * MM,
    y: (PAGE_HEIGHT_MM - 15.5) * MM,
  })

  if (warnings.length > 0) {
    page.drawText(fitWarning(`Uwaga — ${warnings.join('; ')}`, fonts), {
      color: WARN,
      font: fonts.bold,
      size: 7,
      x: MARGIN_MM * MM,
      y: (PAGE_HEIGHT_MM - 19) * MM,
    })
  }

  const counter = `strona ${number}/${total}`
  page.drawText(counter, {
    color: FAINT,
    font: fonts.regular,
    size: 7,
    x: (PAGE_WIDTH_MM - MARGIN_MM) * MM - fonts.regular.widthOfTextAtSize(counter, 7),
    y: (PAGE_HEIGHT_MM - 11) * MM,
  })
}

// One line and no more: the warning sits in the few millimetres between the
// print instruction and the first row of labels, and a second line would be
// drawn over a sticker.
function fitWarning(text: string, fonts: LabelFonts): string {
  const maxWidth = (PAGE_WIDTH_MM - MARGIN_MM * 2) * MM
  if (fonts.bold.widthOfTextAtSize(text, 7) <= maxWidth) return text

  let cut = text
  while (cut.length > 1 && fonts.bold.widthOfTextAtSize(`${cut}…`, 7) > maxWidth) {
    cut = cut.slice(0, -1)
  }

  return `${cut}…`
}

// A hundred millimetres with a tick every ten, and what it is for written
// underneath. Measuring it is how somebody finds out the sheet came out at 96%
// before cutting thirty stickers rather than after.
function drawRuler(page: PDFPage, fonts: LabelFonts): void {
  const y = (BOTTOM_MM - 10) * MM
  const left = MARGIN_MM * MM

  page.drawLine({
    color: INK,
    end: { x: left + RULER_MM * MM, y },
    start: { x: left, y },
    thickness: 0.4,
  })

  for (let tick = 0; tick <= RULER_MM / 10; tick += 1) {
    const x = left + tick * 10 * MM
    page.drawLine({
      color: INK,
      end: { x, y: y + (tick % 5 === 0 ? 3 : 1.6) * MM },
      start: { x, y },
      thickness: 0.4,
    })
  }

  page.drawText('Kontrola skali: powyższy odcinek = dokładnie 100 mm.', {
    color: FAINT,
    font: fonts.regular,
    size: 7,
    x: left,
    y: y - 4.5 * MM,
  })
}
