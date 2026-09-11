import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertAllowed,
  PhotoEditUnavailableError,
  pickGeminiImage,
  type PhotoEditConfig,
} from './photo-edit'

function config(overrides: Partial<PhotoEditConfig> = {}): PhotoEditConfig {
  return { allowed: ['local'], geminiKey: '', removeBgKey: '', ...overrides }
}

test('a method the installation does not allow is refused before any bytes move', () => {
  // The check is in one place, so neither screen can talk the server into
  // spending a key it was told not to use.
  assert.throws(() => assertAllowed(config(), 'removebg'), PhotoEditUnavailableError)
  assert.throws(() => assertAllowed(config({ allowed: [] }), 'local'), PhotoEditUnavailableError)

  assertAllowed(config(), 'local')
  assertAllowed(config({ allowed: ['local', 'gemini'] }), 'gemini')
})

test('the image is found wherever the model put it', () => {
  const png = Buffer.from('pretend png').toString('base64')

  const payload = {
    steps: [
      { content: [{ text: 'Sure, here it is', type: 'text' }], type: 'model_output' },
      { content: [{ data: png, type: 'image' }], type: 'model_output' },
    ],
  }

  assert.deepEqual(pickGeminiImage(payload), new Uint8Array(Buffer.from('pretend png')))
})

test('an answer with no picture in it reads as no picture', () => {
  // A refusal, or a model that decided to explain instead of draw.
  for (const payload of [
    null,
    {},
    { steps: 'nope' },
    { steps: [] },
    { steps: [{ content: [{ text: 'I cannot do that', type: 'text' }] }] },
    { steps: [{ content: [{ data: '', type: 'image' }] }] },
  ]) {
    assert.equal(pickGeminiImage(payload), null, JSON.stringify(payload))
  }
})
