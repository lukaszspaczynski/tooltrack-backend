// Where each label goes on an A4 sheet. Pure: millimetres in, millimetres out,
// no PDF and no catalog, so the packing can be argued with in a test.
//
// The measurements are the sibling Qbrick project's `arkusz_zbiorczy` — the
// same margins, the same 2 mm gutter, the same band at the top for the header
// and at the bottom for the ruler. A sheet from here and a sheet from there
// are cut the same way, which is the whole reason for copying them.
//
// The packing differs, and has to: over there every sticker in a batch is the
// same width, so the page is a set of columns. Here a 200 mm lid and a 30 mm
// front go on one sheet, and columns would leave a 170 mm strip of paper empty
// beside every front. Rows of decreasing height waste less and are easier to
// cut: a whole row comes off with one straight pass.

export type SheetSize = { heightMm: number; widthMm: number }

export type Placement = {
  heightMm: number
  // Into the list that was handed in, so the caller knows which artwork to draw.
  index: number
  page: number
  // Turned a quarter so it fits across the paper. The footprint below is the
  // turned one; the artwork is still its own way round.
  rotated: boolean
  widthMm: number
  // The bottom left corner of the footprint, from the page's bottom left — PDF
  // coordinates, so nothing has to be flipped later.
  xMm: number
  yMm: number
}

export type SheetLayout = {
  pages: number
  placements: Placement[]
  // Labels too big for the paper even turned. None of the sizes a case can
  // hold is anywhere near that, but a sheet that silently loses one would be
  // worse than a sheet that says so.
  skipped: number[]
}

export const PAGE_WIDTH_MM = 210
export const PAGE_HEIGHT_MM = 297
export const MARGIN_MM = 10
// Room for the title and the two lines under it.
export const TOP_MM = 20
// Room for the ruler and its caption.
export const BOTTOM_MM = 24
// Two millimetres between labels: enough to get scissors in, little enough
// that a sheet of thirty does not become a sheet of twenty.
export const GUTTER_MM = 2

export const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_MM * 2
export const CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - TOP_MM - BOTTOM_MM

// Millimetres compared after arithmetic, so a label exactly as wide as the
// space does not fall out of it over a rounding error.
const EPSILON = 1e-6

export function layoutSheet(sizes: SheetSize[]): SheetLayout {
  const skipped: number[] = []
  const boxes: { heightMm: number; index: number; rotated: boolean; widthMm: number }[] = []

  sizes.forEach((size, index) => {
    const footprint = fitToPage(size)
    if (!footprint) {
      skipped.push(index)
      return
    }

    boxes.push({ ...footprint, index })
  })

  // Tallest first, so the short ones fill in beside the tall ones rather than
  // leaving a band of empty paper under them. Stable, so labels of one size
  // stay in the order they were asked for.
  const ordered = [...boxes].sort((a, b) => b.heightMm - a.heightMm)

  const placements: Placement[] = []
  const remaining = [...ordered]
  let page = 0
  let rowTopMm = PAGE_HEIGHT_MM - TOP_MM
  let rowHeightMm = 0
  let cursorXMm = MARGIN_MM

  while (remaining.length > 0) {
    const freeWidthMm = MARGIN_MM + CONTENT_WIDTH_MM - cursorXMm
    // Measured from the top of the row rather than from the row's own height:
    // a label shorter than the one beside it still has the whole page under it.
    const freeHeightMm = rowTopMm - BOTTOM_MM

    // The tallest one that still fits where the cursor is. Taking the first
    // that fits rather than insisting on the tallest overall is what fills the
    // band left under a tall row: four turned lids leave 50 mm at the foot of
    // the page, which is a row of fronts rather than a blank strip.
    const next = remaining.findIndex(
      (box) => box.widthMm <= freeWidthMm + EPSILON && box.heightMm <= freeHeightMm + EPSILON,
    )

    if (next === -1) {
      // Nothing fits beside what is already in this row, so the row is done —
      // and if the row was empty, it is the page that is done.
      if (rowHeightMm > 0) {
        rowTopMm -= rowHeightMm + GUTTER_MM
        rowHeightMm = 0
        cursorXMm = MARGIN_MM
      } else {
        page += 1
        rowTopMm = PAGE_HEIGHT_MM - TOP_MM
        cursorXMm = MARGIN_MM
      }
      continue
    }

    const [box] = remaining.splice(next, 1)

    placements.push({
      heightMm: box.heightMm,
      index: box.index,
      page,
      rotated: box.rotated,
      widthMm: box.widthMm,
      xMm: cursorXMm,
      yMm: rowTopMm - box.heightMm,
    })

    cursorXMm += box.widthMm + GUTTER_MM
    rowHeightMm = Math.max(rowHeightMm, box.heightMm)
  }

  return { pages: placements.length === 0 ? 0 : page + 1, placements, skipped }
}

// A 200 mm lid is wider than the 190 mm of paper between the margins, so it
// goes on sideways. Turning is free — the sticker is cut out either way — and
// it is the difference between a lid on a gang sheet and a lid that needs its
// own page.
function fitToPage(
  size: SheetSize,
): null | { heightMm: number; rotated: boolean; widthMm: number } {
  if (fits(size.widthMm, size.heightMm)) {
    return { heightMm: size.heightMm, rotated: false, widthMm: size.widthMm }
  }
  if (fits(size.heightMm, size.widthMm)) {
    return { heightMm: size.widthMm, rotated: true, widthMm: size.heightMm }
  }

  return null
}

function fits(widthMm: number, heightMm: number): boolean {
  return widthMm <= CONTENT_WIDTH_MM + EPSILON && heightMm <= CONTENT_HEIGHT_MM + EPSILON
}
