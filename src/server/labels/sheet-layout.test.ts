import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BOTTOM_MM,
  CONTENT_WIDTH_MM,
  GUTTER_MM,
  layoutSheet,
  MARGIN_MM,
  PAGE_HEIGHT_MM,
  TOP_MM,
  type Placement,
} from './sheet-layout'

const front = { heightMm: 40, widthMm: 30 }
const lid = { heightMm: 60, widthMm: 200 }

function on(placements: Placement[], page: number): Placement[] {
  return placements.filter((placement) => placement.page === page)
}

test('nothing to place is no pages at all', () => {
  assert.deepEqual(layoutSheet([]), { pages: 0, placements: [], skipped: [] })
})

test('labels sit inside the margins, under the header and above the ruler', () => {
  const { placements } = layoutSheet([front, front, front])

  for (const placement of placements) {
    assert.ok(placement.xMm >= MARGIN_MM)
    assert.ok(placement.xMm + placement.widthMm <= MARGIN_MM + CONTENT_WIDTH_MM)
    assert.ok(placement.yMm >= BOTTOM_MM)
    assert.ok(placement.yMm + placement.heightMm <= PAGE_HEIGHT_MM - TOP_MM)
  }
})

test('a row is filled across before a new one is started', () => {
  // 190 mm of paper takes six 30 mm fronts with 2 mm between them.
  const { pages, placements } = layoutSheet(Array.from({ length: 6 }, () => front))

  assert.equal(pages, 1)
  assert.deepEqual(
    placements.map((placement) => placement.yMm),
    placements.map(() => placements[0].yMm),
  )
  assert.deepEqual(
    placements.map((placement) => placement.xMm),
    [0, 1, 2, 3, 4, 5].map((column) => MARGIN_MM + column * (30 + GUTTER_MM)),
  )
})

test('the seventh front drops to the next row, a gutter below', () => {
  const { pages, placements } = layoutSheet(Array.from({ length: 7 }, () => front))

  assert.equal(pages, 1)
  assert.equal(placements[6].xMm, MARGIN_MM)
  assert.equal(placements[6].yMm, placements[0].yMm - 40 - GUTTER_MM)
})

test('a lid wider than the paper goes on sideways', () => {
  // 200 mm across is more than the 190 mm between the margins, and turning it
  // is free: the sticker is cut out either way.
  const { placements, skipped } = layoutSheet([lid])

  assert.deepEqual(skipped, [])
  assert.equal(placements[0].rotated, true)
  assert.equal(placements[0].widthMm, 60)
  assert.equal(placements[0].heightMm, 200)
})

test('the tall ones go first so the short ones fill in beside them', () => {
  // Otherwise a turned lid leaves a 130 mm band of empty paper down its side.
  const { pages, placements } = layoutSheet([front, lid, front])

  assert.equal(pages, 1)
  assert.equal(placements[0].index, 1)
  // Both fronts share the lid's row rather than starting one under it.
  assert.deepEqual(
    placements.slice(1).map((placement) => placement.yMm + placement.heightMm),
    [PAGE_HEIGHT_MM - TOP_MM, PAGE_HEIGHT_MM - TOP_MM],
  )
  assert.equal(placements[1].xMm, MARGIN_MM + 60 + GUTTER_MM)
})

test('each placement points back at the label it is for', () => {
  const { placements } = layoutSheet([front, lid, front])

  assert.deepEqual([...placements].map((placement) => placement.index).sort(), [0, 1, 2])
})

test('labels of one size keep the order they were asked for', () => {
  // The sort is by height only, so the sheet reads in the order the screen
  // sent — a box's labels stay together.
  const { placements } = layoutSheet([front, front, front, front])

  assert.deepEqual(
    placements.map((placement) => placement.index),
    [0, 1, 2, 3],
  )
})

test('what does not fit on one page starts the next', () => {
  // Six per row, six rows of 40 mm and their gutters fit in 253 mm; the
  // seventh row does not.
  const { pages, placements } = layoutSheet(Array.from({ length: 43 }, () => front))

  assert.equal(pages, 2)
  assert.equal(on(placements, 0).length, 36)
  assert.equal(on(placements, 1).length, 7)
  assert.equal(on(placements, 1)[0].yMm + 40, PAGE_HEIGHT_MM - TOP_MM)
})

test('the band under a tall row is filled rather than left blank', () => {
  // Four turned lids take the width and 200 mm of the height, which leaves
  // 51 mm at the foot of the page: a row of fronts, not a blank strip. The
  // 80 mm label that comes next in height order cannot go there and waits for
  // the second page rather than sending the fronts there with it.
  const lids = Array.from({ length: 4 }, () => ({ heightMm: 60, widthMm: 200 }))
  const { placements } = layoutSheet([...lids, { heightMm: 80, widthMm: 30 }, front, front])

  const fronts = placements.filter((placement) => placement.heightMm === 40)
  assert.deepEqual(
    fronts.map((placement) => placement.page),
    [0, 0],
  )
  assert.equal(placements.find((placement) => placement.heightMm === 80)?.page, 1)
})

test('a label too big for the paper either way is left out and named', () => {
  // No case has a place like this. A sheet that quietly lost one would be
  // worse than a sheet that says which.
  const { pages, placements, skipped } = layoutSheet([front, { heightMm: 400, widthMm: 300 }])

  assert.deepEqual(skipped, [1])
  assert.equal(placements.length, 1)
  assert.equal(pages, 1)
})
