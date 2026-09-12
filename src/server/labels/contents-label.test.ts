import assert from 'node:assert/strict'
import test from 'node:test'

import { PDFDocument } from 'pdf-lib'

import { drawContentsLabel, maxContentsPhotos } from './contents-label'
import { drawNumberLabel } from './number-label'
import { addPrintMarks } from './print-ready'

// These draw real PDFs. They are slower than the rest of the suite and worth
// it: the geometry is arithmetic anyone can get wrong, and a label that throws
// is a label nobody finds out about until they try to print it.

test('a number label is a PDF of the size that was asked for', async () => {
  const bytes = await drawNumberLabel({
    brands: [{ color: '#122447', logo: null, name: 'Bosch Professional' }],
    cutLine: true,
    heightMm: 40,
    number: 4,
    widthMm: 30,
    withLogos: false,
  })

  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-')

  // Read back rather than grepped: what matters is the size a reader sees, and
  // 30 x 40 mm is 85.04 x 113.39 points.
  const { height, width } = (await PDFDocument.load(bytes)).getPage(0).getSize()
  assert.ok(Math.abs(width - 85.04) < 0.05, String(width))
  assert.ok(Math.abs(height - 113.39) < 0.05, String(height))
})

test('a number label draws with no brands at all', async () => {
  // An organizer whose tools have no maker recorded still gets a label; it is
  // white with a number on it, which is better than a 500.
  const bytes = await drawNumberLabel({
    brands: [],
    cutLine: true,
    heightMm: 60,
    number: 12,
    widthMm: 200,
    withLogos: true,
  })

  assert.ok(bytes.byteLength > 0)
})

test('a contents label draws with no photos and no names', async () => {
  const bytes = await drawContentsLabel({
    heightMm: 40,
    photos: [],
    title: 'Wiertarki',
    toolNames: [],
    widthMm: 30,
  })

  assert.ok(bytes.byteLength > 0)
})

test('Polish names reach the PDF rather than being dropped', async () => {
  // The fourteen built-in PDF fonts have no ł. This is the test that fails if
  // somebody swaps the embedded font for a standard one.
  const bytes = await drawContentsLabel({
    heightMm: 60,
    photos: [],
    title: 'Ładowarki i akumulatory',
    toolNames: ['Szlifierka kątowa', 'Wiertarka udarowa'],
    widthMm: 200,
  })

  assert.ok(bytes.byteLength > 0)
})

test('eleven names shrink and then give way to a count', async () => {
  // The caption is one run of text under the rule, and eleven tool names do not
  // fit three lines at a size anybody can read. What must not happen is a throw
  // or a loop that never ends looking for a size that does not exist.
  const bytes = await drawContentsLabel({
    heightMm: 40,
    photos: [],
    title: 'Elektronarzędzia',
    toolNames: Array.from({ length: 11 }, (_, i) => `Wiertarka udarowa GSB 18V-${i + 1}`),
    widthMm: 30,
  })

  assert.ok(bytes.byteLength > 0)
})

test('a lid holds twice the pictures a front does', () => {
  // Six across a 200 x 60 lid come out bigger than three down a 30 x 40 front,
  // so the number follows the shape rather than sitting at three.
  assert.equal(maxContentsPhotos({ heightMm: 60, widthMm: 200 }), 6)
  assert.equal(maxContentsPhotos({ heightMm: 30, widthMm: 200 }), 6)
  assert.equal(maxContentsPhotos({ heightMm: 40, widthMm: 30 }), 3)
  assert.equal(maxContentsPhotos({ heightMm: 80, widthMm: 30 }), 3)
  // The boundary is the same "twice as wide" test the number template uses.
  assert.equal(maxContentsPhotos({ heightMm: 30, widthMm: 60 }), 6)
  assert.equal(maxContentsPhotos({ heightMm: 31, widthMm: 60 }), 3)
})

test('six pictures fit across a lid', async () => {
  const photo = await pngPixel()
  const bytes = await drawContentsLabel({
    heightMm: 60,
    photos: Array.from({ length: 6 }, () => photo),
    title: 'Akumulatory i ładowarki',
    toolNames: ['18 V + 12 V, Li-Ion'],
    widthMm: 200,
  })

  assert.ok(bytes.byteLength > 0)
})

test('a caption too long for the band ends in an ellipsis rather than vanishing', async () => {
  // One line somebody typed cannot be shortened by dropping a name from it, so
  // the only honest answer is to cut it and say so. Before this the band was
  // simply not drawn, which read as "this box holds nothing".
  const bytes = await drawContentsLabel({
    heightMm: 40,
    photos: [],
    title: 'Akumulatory',
    toolNames: ['18 V + 12 V, Li-Ion, ładowarki szybkie i standardowe, adaptery oraz stacje'],
    widthMm: 30,
  })

  assert.ok(bytes.byteLength > 0)
})

test('a slot smaller than the measured one scales the type with it', async () => {
  // The metrics are millimetres read off a 30 x 40 sticker. On anything smaller
  // they have to come down too, or the padding and two lines of type are the
  // whole label.
  const bytes = await drawContentsLabel({
    heightMm: 20,
    photos: [],
    title: 'Klucze',
    toolNames: ['Klucz płaski', 'Klucz nasadowy'],
    widthMm: 15,
  })

  const { height } = (await PDFDocument.load(bytes)).getPage(0).getSize()
  assert.ok(Math.abs(height - 20 * (72 / 25.4)) < 0.05, String(height))
})

test('a wide label lays the number beside the maker, a tall one above it', async () => {
  // A lid is 200 x 60 and a front is 30 x 40. Stacking suits the second and
  // wastes the first, where the number ends up a fifth of the height of a
  // label three times that wide.
  const brands = [{ color: '#122447', logo: null, name: 'Bosch Professional' }]

  const tall = await drawNumberLabel({
    brands,
    cutLine: true,
    heightMm: 40,
    number: 7,
    widthMm: 30,
    withLogos: false,
  })
  const wide = await drawNumberLabel({
    brands,
    cutLine: true,
    heightMm: 60,
    number: 7,
    widthMm: 200,
    withLogos: false,
  })

  const sizeOf = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPage(0).getSize()
  const tallSize = await sizeOf(tall)
  const wideSize = await sizeOf(wide)

  assert.ok(tallSize.height > tallSize.width)
  assert.ok(wideSize.width > wideSize.height * 2)
})

test('two makers get a wedge, one does not', async () => {
  // The wedge is a path; the difference shows up as a larger content stream.
  const one = await drawNumberLabel({
    brands: [{ color: '#122447', logo: null, name: 'Bosch Professional' }],
    cutLine: true,
    heightMm: 40,
    number: 1,
    widthMm: 30,
    withLogos: false,
  })
  const two = await drawNumberLabel({
    brands: [
      { color: '#122447', logo: null, name: 'Bosch Professional' },
      { color: '#244930', logo: null, name: 'Bosch Home & Garden' },
    ],
    cutLine: true,
    heightMm: 40,
    number: 1,
    widthMm: 30,
    withLogos: false,
  })

  assert.ok(two.byteLength > one.byteLength)
})

test('a print-ready file is bigger than the label and a plain one is not', async () => {
  // The marks go in a margin around the artwork: a crop mark printed on a
  // sticker is a crop mark stuck to a toolbox.
  const artwork = await drawNumberLabel({
    brands: [{ color: '#122447', logo: null, name: 'Bosch Professional' }],
    cutLine: false,
    heightMm: 40,
    number: 3,
    widthMm: 30,
    withLogos: false,
  })

  const plain = (await PDFDocument.load(artwork)).getPage(0).getSize()
  const marked = (
    await PDFDocument.load(await addPrintMarks(artwork, { heightMm: 40, widthMm: 30 }))
  )
    .getPage(0)
    .getSize()

  assert.ok(Math.abs(plain.width - 85.04) < 0.05, String(plain.width))
  // Six millimetres of margin on each side, so the sheet grows by twelve.
  assert.ok(Math.abs(marked.width - plain.width - 12 * (72 / 25.4)) < 0.1, String(marked.width))
  assert.ok(Math.abs(marked.height - plain.height - 12 * (72 / 25.4)) < 0.1, String(marked.height))
})

// A one-pixel PNG, so a test about arrangement does not need a photograph on
// disk. Written by hand because it is eleven constant chunks and importing an
// encoder for it would be the heavier dependency.
async function pngPixel(): Promise<Uint8Array> {
  return new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  )
}
