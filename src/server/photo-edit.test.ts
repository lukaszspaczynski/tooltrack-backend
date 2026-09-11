import assert from 'node:assert/strict'
import test from 'node:test'

import { photoEditProvider, PhotoEditUnavailableError, pickGeminiImage } from './photo-edit'

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const NO_KEYS = {
  GEMINI_API_KEY: undefined,
  REMOVE_BG_API_KEY: undefined,
  TOOLTRACK_PHOTO_EDIT: undefined,
}

test('the local method is the default — it needs no key and costs nothing', () => {
  withEnv(NO_KEYS, () => assert.equal(photoEditProvider(), 'local'))
})

test('a configured key does not silently start spending money', () => {
  // Paying for a cutout is opted into by naming the provider, not by having a
  // key lying in the environment.
  withEnv({ ...NO_KEYS, GEMINI_API_KEY: 'g', REMOVE_BG_API_KEY: 'r' }, () =>
    assert.equal(photoEditProvider(), 'local'),
  )

  withEnv({ ...NO_KEYS, REMOVE_BG_API_KEY: 'r', TOOLTRACK_PHOTO_EDIT: 'removebg' }, () =>
    assert.equal(photoEditProvider(), 'removebg'),
  )
  withEnv({ ...NO_KEYS, GEMINI_API_KEY: 'g', TOOLTRACK_PHOTO_EDIT: 'gemini' }, () =>
    assert.equal(photoEditProvider(), 'gemini'),
  )
})

test('auto is its own mode: local first, a service only when local refuses', () => {
  withEnv({ ...NO_KEYS, REMOVE_BG_API_KEY: 'r', TOOLTRACK_PHOTO_EDIT: 'auto' }, () =>
    assert.equal(photoEditProvider(), 'auto'),
  )
  // Without any key it is still auto — the fallback simply has nowhere to go,
  // and the local refusal reaches the caller unchanged.
  withEnv({ ...NO_KEYS, TOOLTRACK_PHOTO_EDIT: 'auto' }, () =>
    assert.equal(photoEditProvider(), 'auto'),
  )
})

test('a named provider without its key is refused, not quietly swapped', () => {
  withEnv({ ...NO_KEYS, GEMINI_API_KEY: 'g', TOOLTRACK_PHOTO_EDIT: 'removebg' }, () =>
    assert.throws(() => photoEditProvider(), PhotoEditUnavailableError),
  )
  withEnv({ ...NO_KEYS, REMOVE_BG_API_KEY: 'r', TOOLTRACK_PHOTO_EDIT: 'none' }, () =>
    assert.equal(photoEditProvider(), 'none'),
  )
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
