// Template 2: what is inside.
//
// A white card with a navy frame: the pictures of the tools filling the top,
// the organizer's name under them, a rule, and the tool names in caps along
// the bottom. Every measurement is read off the Qbrick `label_tool` sticker
// rather than chosen — a 30 x 40 mm label from here goes on the shelf next to
// one from there, and the two have to look like one set.
//
// The arrangement of the pictures is the one part that is computed: the label
// is 30 x 40 mm on a front and 200 x 60 mm on a lid, and a row that suits one
// is hopeless on the other. Every split into rows and columns is measured and
// the one that draws them largest wins.

import { rgb, type PDFFont } from 'pdf-lib'

import {
  CORNER,
  drawCentred,
  fitFontSize,
  MM,
  roundedRectPath,
  startLabel,
  wrapText,
  type LabelPage,
} from './pdf'

export const MAX_CONTENTS_PHOTOS = 3

export type ContentsLabelInput = {
  heightMm: number
  // Up to three, already read from disk. PNG, because everything stored is.
  photos: Uint8Array[]
  title: null | string
  toolNames: string[]
  widthMm: number
}

// Millimetres, off the Qbrick sticker. Absolute rather than a share of the
// label, because matching that sheet is the whole point of the shape; the
// taller set is what a label 60 mm or more gets there, so it is what one gets
// here.
const METRICS = {
  large: { caption: 3.5, gap: 1.7, pad: 1.9, title: 4.4 },
  small: { caption: 2.5, gap: 1.1, pad: 1.5, title: 3.1 },
}

const LARGE_FROM_MM = 60
// The size the metrics were measured at. A smaller label scales all of them
// down with it; a larger one keeps them, or a lid becomes a poster.
const MEASURED_AT_MM = 40

const CAPTION_LINES = 3
const TITLE_LINES = 2
// Below this nothing is worth reading, so names are dropped instead.
const MIN_SIZE_MM = 1.8
// A title that only just fits one line is better one size down than broken in
// two: "Ładowarki i akumulatory" split after "i" reads worse than the same
// words smaller.
const UNBROKEN = 0.7
const LINE_HEIGHT = 1.2
const PHOTO_GAP_MM = 0.6
const RULE_INSET_MM = 0.6

const FRAME_WIDTH = 0.7
const RULE_WIDTH = 0.5

// Qbrick's TEXT_NAVY. Frame, rule and both lines of type are all this one
// colour: on a white card the drawing has to hold together without any.
const INK = rgb(0.043, 0.145, 0.29)

export async function drawContentsLabel(input: ContentsLabelInput): Promise<Uint8Array> {
  const label = await startLabel(input.widthMm, input.heightMm)
  const metric = input.heightMm >= LARGE_FROM_MM ? METRICS.large : METRICS.small
  const scale = Math.min(1, input.heightMm / MEASURED_AT_MM) * MM

  const pad = metric.pad * scale
  const gap = metric.gap * scale
  const minSize = MIN_SIZE_MM * scale
  const inner = label.width - pad * 2

  drawCard(label)

  const caption =
    input.toolNames.length > 0
      ? captionBlock(input.toolNames, label.fonts.bold, metric.caption * scale, minSize, inner)
      : null
  const title = input.title
    ? titleBlock(input.title, label.fonts.bold, metric.title * scale, minSize, inner)
    : null

  const captionHeight = blockHeight(caption)
  const titleHeight = blockHeight(title)

  // From the bottom edge up: the padding, the caption, the rule sitting in the
  // gap above it, the title, and a little air before the pictures start.
  const textHeight =
    caption || title ? pad + captionHeight + (caption ? gap : 0) + titleHeight + gap * 0.6 : pad

  // With pictures the type sits along the bottom, where the reference puts it.
  // With none it would be a line of words stranded under an empty card, so the
  // block rides up to the middle instead.
  const lift = input.photos.length > 0 ? 0 : (label.height - textHeight) / 2

  if (caption) {
    drawBlock(label, caption, lift + pad + captionHeight - caption.size)

    const y = lift + pad + captionHeight + gap * 0.55
    label.page.drawLine({
      color: INK,
      end: { x: label.width - pad - RULE_INSET_MM * scale, y },
      start: { x: pad + RULE_INSET_MM * scale, y },
      thickness: RULE_WIDTH,
    })
  }

  if (title) drawBlock(label, title, lift + textHeight - title.size)

  if (input.photos.length > 0) {
    await drawPhotos(label, input.photos, {
      bottom: textHeight + gap * 0.4,
      gap: PHOTO_GAP_MM * scale,
      left: pad,
      right: label.width - pad,
      top: label.height - pad,
    })
  }

  return label.doc.save()
}

// The card and its frame. The frame stands in for the cut line the other
// template draws: it is printed at the trim, so the scissors already have
// something to follow and a grey guide under it would only print twice.
function drawCard(label: LabelPage): void {
  const radius = Math.min(label.width, label.height) * CORNER

  label.page.drawSvgPath(roundedRectPath(label.width, label.height, radius), {
    color: rgb(1, 1, 1),
    x: 0,
    y: label.height,
  })

  // Inset by half its own width: a stroke centred on the page edge loses the
  // outer half to the crop and prints as a hairline.
  const inset = FRAME_WIDTH / 2
  label.page.drawSvgPath(
    roundedRectPath(label.width - FRAME_WIDTH, label.height - FRAME_WIDTH, radius - inset),
    { borderColor: INK, borderWidth: FRAME_WIDTH, x: inset, y: label.height - inset },
  )
}

type TextBlock = { lines: string[]; size: number }

function blockHeight(block: null | TextBlock): number {
  return block ? block.lines.length * block.size * LINE_HEIGHT : 0
}

function drawBlock(label: LabelPage, block: TextBlock, firstBaseline: number): void {
  let y = firstBaseline

  for (const line of block.lines) {
    drawCentred(label, line, { color: INK, font: label.fonts.bold, size: block.size, y })
    y -= block.size * LINE_HEIGHT
  }
}

// The largest size at which the text stands in maxLines of the given width.
// Null when even the smallest size cannot hold it — the caller then has to ask
// for less text rather than smaller type.
function fitBlock(
  text: string,
  font: PDFFont,
  maxSize: number,
  minSize: number,
  maxWidth: number,
  maxLines: number,
): null | TextBlock {
  for (let size = maxSize; size >= minSize; size -= 0.1 * MM) {
    const lines = wrapText(text, font, size, maxWidth)
    const fits =
      lines.length <= maxLines && lines.every((l) => font.widthOfTextAtSize(l, size) <= maxWidth)

    if (fits) return { lines, size }
  }

  return null
}

// The organizer's name, the largest thing on the card.
function titleBlock(
  text: string,
  font: PDFFont,
  maxSize: number,
  minSize: number,
  maxWidth: number,
): TextBlock {
  const unbroken = fitFontSize(text, font, maxSize, maxWidth)
  if (unbroken >= maxSize * UNBROKEN) return { lines: [text], size: unbroken }

  return (
    fitBlock(text, font, maxSize, minSize, maxWidth, TITLE_LINES) ?? {
      lines: wrapText(text, font, minSize, maxWidth).slice(0, TITLE_LINES),
      size: minSize,
    }
  )
}

// What is in the box, in caps under the rule, the way "18 V + 12 V, LI-ION"
// runs along the bottom of the Qbrick stickers. An organizer can hold eleven
// tools and eleven names do not fit three lines at a size anybody can read, so
// the tail becomes "+3 więcej": that is information, where a list that simply
// stops is a label somebody has to check against the box.
function captionBlock(
  names: string[],
  font: PDFFont,
  maxSize: number,
  minSize: number,
  maxWidth: number,
): null | TextBlock {
  let smallest: string[] = []

  for (let shown = names.length; shown > 0; shown -= 1) {
    const hidden = names.length - shown
    const text = [...names.slice(0, shown), ...(hidden > 0 ? [`+${hidden} więcej`] : [])]
      .join(', ')
      .toLocaleUpperCase('pl-PL')

    const block = fitBlock(text, font, maxSize, minSize, maxWidth, CAPTION_LINES)
    if (block) return block

    smallest = wrapText(text, font, minSize, maxWidth)
  }

  // Nothing fits, not even one name at the smallest size — a caption somebody
  // typed by hand, or a single tool with a very long name. Three lines of it
  // ending in an ellipsis beats the band vanishing, which is what dropping the
  // caption here used to do.
  if (smallest.length === 0) return null

  const lines = smallest.slice(0, CAPTION_LINES)
  lines[lines.length - 1] = `${lines[lines.length - 1]}…`

  return { lines, size: minSize }
}

type Area = { bottom: number; gap: number; left: number; right: number; top: number }

// Every arrangement that holds the pictures, measured; the one that draws them
// largest wins. Three pictures on a lid want one row, on a front two over one.
async function drawPhotos(label: LabelPage, photos: Uint8Array[], area: Area): Promise<void> {
  const width = area.right - area.left
  const height = area.top - area.bottom
  if (width <= 0 || height <= 0) return

  const images = await Promise.all(photos.map((bytes) => label.doc.embedPng(bytes)))
  const gap = area.gap

  // The measure is how much of the label the pictures actually cover once each
  // is fitted into its cell keeping its shape. Comparing cell sizes instead
  // rewards a grid with an empty cell in it — three pictures in a 2 x 2 beat
  // three in a column, and a quarter of the label goes to nothing.
  let best = { area: 0, cols: 1 }
  for (let cols = 1; cols <= images.length; cols += 1) {
    const rows = Math.ceil(images.length / cols)
    const cellWidth = (width - gap * (cols - 1)) / cols
    const cellHeight = (height - gap * (rows - 1)) / rows
    if (cellWidth <= 0 || cellHeight <= 0) continue

    const covered = images.reduce((total, image) => {
      const scale = Math.min(cellWidth / image.width, cellHeight / image.height)
      return total + image.width * scale * (image.height * scale)
    }, 0)

    if (covered > best.area) best = { area: covered, cols }
  }

  const { cols } = best
  const rows = Math.ceil(images.length / cols)
  const cellWidth = (width - gap * (cols - 1)) / cols
  const cellHeight = (height - gap * (rows - 1)) / rows

  images.forEach((image, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    const scale = Math.min(cellWidth / image.width, cellHeight / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale

    // The last row is usually short — three pictures in a 2 x 2 leave one cell
    // empty. Centring that row is the difference between a label that looks
    // arranged and one that looks like it lost a picture.
    const inRow = Math.min(cols, images.length - row * cols)
    const rowWidth = inRow * cellWidth + (inRow - 1) * gap
    const rowLeft = area.left + (width - rowWidth) / 2

    label.page.drawImage(image, {
      height: drawHeight,
      width: drawWidth,
      x: rowLeft + col * (cellWidth + gap) + (cellWidth - drawWidth) / 2,
      y: area.top - (row + 1) * cellHeight - row * gap + (cellHeight - drawHeight) / 2,
    })
  })
}
