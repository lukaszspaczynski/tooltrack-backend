// A picture of the label, for the list.
//
// The PDF is the artefact; this is a raster of its first page, made once when
// the label is made. Rendered from the finished file rather than drawn a
// second time: one drawing means the tile cannot quietly disagree with what
// comes out of the printer.
//
// A preview is a convenience and never a reason to fail a label — the caller
// keeps the PDF when this throws.

import { PDFiumLibrary } from '@hyzyla/pdfium'
import sharp from 'sharp'

// The tile is about 240 px across; twice that survives a retina panel and
// still weighs a few kilobytes.
const LONGEST_SIDE_PX = 480

let library: null | Promise<PDFiumLibrary> = null

// pdfium here is WebAssembly, so the labels module still needs no native build
// — the same reason pdf-lib was chosen next door. The module is eleven
// megabytes, though, so it is instantiated once and kept: a per-label init
// would be most of the time spent making a label.
function pdfium(): Promise<PDFiumLibrary> {
  library ??= PDFiumLibrary.init()
  return library
}

export async function renderLabelPreview(pdf: Uint8Array): Promise<Uint8Array> {
  const document = await (await pdfium()).loadDocument(Buffer.from(pdf))

  try {
    const page = document.getPage(0)
    const { originalHeight, originalWidth } = page.getOriginalSize()
    const scale = LONGEST_SIDE_PX / Math.max(originalWidth, originalHeight)

    // Left on the default white ground rather than rendered transparent: a
    // label is a thing printed on paper, and a tile that shows the paper is
    // what somebody is comparing against the box.
    const rendered = await page.render({
      render: (options) =>
        sharp(options.data, {
          raw: { channels: 4, height: options.height, width: options.width },
        })
          .png({ compressionLevel: 9, effort: 7 })
          .toBuffer(),
      scale,
    })

    return rendered.data
  } finally {
    document.destroy()
  }
}
