// Drawing labels again, for both routes that do it: the one under an organizer
// and the one over all of them.
//
// The row keeps its id, its size and its options; only the file underneath it
// changes. That is the whole point of storing what the generator was told: a
// label made before an item was added, or before a maker got its logo, becomes
// current without anybody retyping the wizard.

import { generateLabel, LabelDataError, type LabelOptions } from '../labels/generate'
import { renderLabelPreview } from '../labels/preview'
import { deleteLabelPdf, saveLabelPdf, saveLabelPreview } from '../labels/storage'
import type { LabelToRedraw } from './labels-store'
import { replaceLabelFile } from './organizers-store'

export type RedrawResult = { failed: { error: string; id: number }[]; refreshed: number }

// One label that cannot be drawn — a contents label whose photos have since
// been deleted — must not stop the rest, so the failures come back named
// rather than as a status. Nine redrawn and one explained beats a 400 that
// leaves all ten stale.
export async function redrawLabels(labels: LabelToRedraw[]): Promise<RedrawResult> {
  const failed: { error: string; id: number }[] = []
  let refreshed = 0

  for (const label of labels) {
    try {
      const bytes = await generateLabel(
        label.organizerId,
        { heightMm: label.heightMm, widthMm: label.widthMm },
        label.options as unknown as LabelOptions,
      )
      const stored = await saveLabelPdf(bytes)
      const { orphanedPath } = await replaceLabelFile(label.id, {
        byteSize: stored.byteSize,
        pdfPath: stored.path,
        previewPath: await storeLabelPreview(stored.path, bytes),
      })

      // Outside the transaction, like the delete path: a failed unlink must not
      // roll back a row that already points at the new file.
      if (orphanedPath) await deleteLabelPdf(orphanedPath)
      refreshed += 1
    } catch (error) {
      if (!(error instanceof LabelDataError)) throw error
      failed.push({ error: error.message, id: label.id })
    }
  }

  return { failed, refreshed }
}

// The picture is made here rather than in the generator, because it is a fact
// about the file and not about the drawing. A render that fails costs the tile
// its picture and nothing else — the label is already on disk.
export async function storeLabelPreview(pdfPath: string, bytes: Uint8Array): Promise<string> {
  try {
    return await saveLabelPreview(pdfPath, await renderLabelPreview(bytes))
  } catch (error) {
    console.error('[labels] preview failed', error)
    return ''
  }
}
