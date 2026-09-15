import assert from 'node:assert/strict'
import test from 'node:test'

import { belowFloor, clientFloors, compareVersions, parseClientHeader } from './client-version'

test('a build is a name and numbers, and anything else is no build at all', () => {
  assert.deepEqual(parseClientHeader('mobile/1.4.2'), { name: 'mobile', version: '1.4.2' })
  assert.deepEqual(parseClientHeader('  Web/2.0  '), { name: 'web', version: '2.0' })

  // Not understood is not the same as old. Every client that exists today
  // sends none of this, and a floor that refused what it cannot read would
  // take the catalog off the web the moment it was set.
  for (const raw of [null, undefined, '', 'mobile', '1.4.2', 'mobile/wersja', 'mobile/1.4.2-rc1']) {
    assert.equal(parseClientHeader(raw), null, JSON.stringify(raw))
  }

  // Sent twice is a client with a bug, and not a build anybody can name.
  assert.equal(parseClientHeader(['mobile/1.0', 'mobile/9.9']), null)
})

test('versions compare by number, not by string', () => {
  // The reason this is not a string comparison: "10" sorts before "9".
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1)
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1)
  // A missing segment is zero, so these are one build written two ways.
  assert.equal(compareVersions('1.6', '1.6.0'), 0)
  assert.equal(compareVersions('2', '1.99.99'), 1)
})

test('a floor list names each client separately', () => {
  // They are released on different days, so one number for both would mean
  // refusing whichever was shipped last.
  const floors = clientFloors('mobile=1.6.0, web=2.0.0')

  assert.equal(floors.get('mobile'), '1.6.0')
  assert.equal(floors.get('web'), '2.0.0')

  // Junk in the list is skipped rather than throwing. A server that refuses to
  // start over a stray comma is a server somebody edits under pressure.
  assert.equal(clientFloors('mobile=1.6.0,,rubbish,web=').get('mobile'), '1.6.0')
  assert.equal(clientFloors(undefined).size, 0)
})

test('only a build below its own floor is refused', () => {
  const floors = clientFloors('mobile=1.6.0')

  assert.ok(belowFloor('mobile/1.5.9', floors))
  assert.equal(belowFloor('mobile/1.6.0', floors), null)
  assert.equal(belowFloor('mobile/2.0.0', floors), null)

  // A client nobody has set a floor for is not below it. Otherwise the day a
  // second client appears is the day it cannot call anything.
  assert.equal(belowFloor('desktop/0.1.0', floors), null)
  // And no header at all is every client that exists today.
  assert.equal(belowFloor(null, floors), null)
})

test('the refusal says which build called and which one to get', () => {
  // A 426 that only says "too old" leaves somebody comparing screenshots.
  const stale = belowFloor('mobile/1.2.0', clientFloors('mobile=1.6.0'))

  assert.deepEqual(stale, { minimum: '1.6.0', name: 'mobile', version: '1.2.0' })
})

test('no floor at all lets every build through', () => {
  // The state this ships in. The header is worth sending from the first
  // release so the log fills up; the floor is for the first time a change
  // cannot be made by adding.
  assert.equal(belowFloor('mobile/0.0.1', clientFloors('')), null)
})
