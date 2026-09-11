// "Wytnij samo narzędzie" — the AI edit behind
// POST /api/tools/:id/photos/:photoId/cutout.
//
// One operation, not an editor: take a photo of a tool on a workbench, in a
// case, in someone's hand, and give back the tool alone. That is the edit a
// catalog needs, and it is a request a model can be held to. A general "edit
// this picture with a prompt" would be a different product.
//
// The provider is a deploy variable, like the photo search. remove.bg is the
// purpose-built one and returns real transparency; Gemini is the general model
// and returns the tool on a plain background. Neither key is required for the
// rest of the app to work — without one the route answers 503 and says so.

import { cutoutLocally, PhotoNotSuitableError } from './cutout-local'
import { readImageMetadata, type ImageMetadata } from './image-metadata'

export type PhotoEditProvider = 'auto' | 'gemini' | 'local' | 'none' | 'removebg'

export type CutoutResult = {
  bytes: Uint8Array
  metadata: ImageMetadata
  provider: PhotoEditProvider
}

const EDIT_TIMEOUT_MS = 60_000

const GEMINI_MODEL = 'gemini-3.1-flash-image'

// Written for a model that will take it literally. It names what to keep, what
// to remove, and what not to invent — a cutout that "improves" the tool is a
// photo of a tool we do not own.
const CUTOUT_PROMPT = [
  'Cut out only the tool shown in this photo.',
  'Remove the background, the workbench, the case, hands, and every other object.',
  'Place the tool on a plain, uniform white background.',
  'Keep the tool itself exactly as it is: same model, same colours, same wear, same labels and stickers.',
  'Do not add, remove or repaint any part of the tool. Do not add text, shadows, reflections or props.',
].join(' ')

export class PhotoEditUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoEditUnavailableError'
  }
}

export function photoEditProvider(): PhotoEditProvider {
  const configured = process.env.TOOLTRACK_PHOTO_EDIT?.trim().toLowerCase()

  if (configured === 'none') return 'none'
  if (configured === 'local') return 'local'
  if (configured === 'auto') return 'auto'
  if (configured === 'removebg' || configured === 'gemini') {
    if (!aiKeyFor(configured)) {
      throw new PhotoEditUnavailableError(
        `Wycinanie ustawione na ${configured}, ale brakuje klucza API do tej usługi`,
      )
    }
    return configured
  }

  // Local by default: no key, no cost, an answer in milliseconds, and the
  // photos this catalog imports from a web search are exactly what it handles
  // — a tool on a plain background. A paid service is opted into.
  return 'local'
}

function aiKeyFor(provider: 'gemini' | 'removebg'): boolean {
  const key = provider === 'removebg' ? process.env.REMOVE_BG_API_KEY : process.env.GEMINI_API_KEY
  return Boolean(key?.trim())
}

// Which paid service `auto` falls back to. remove.bg first: it is built for
// this one job and returns real transparency, where a general model returns a
// regenerated picture.
function configuredAiProvider(): null | 'gemini' | 'removebg' {
  if (aiKeyFor('removebg')) return 'removebg'
  if (aiKeyFor('gemini')) return 'gemini'
  return null
}

export async function cutoutSubject(bytes: Uint8Array, contentType: string): Promise<CutoutResult> {
  const configured = photoEditProvider()
  if (configured === 'none') {
    throw new PhotoEditUnavailableError('Wycinanie narzędzia jest wyłączone na tym serwerze')
  }

  // `auto` tries the free local method first and only pays for a service when
  // the photo is one the local method refuses — a picture from a workbench
  // rather than from a catalogue.
  if (configured === 'auto') {
    try {
      return finish(await cutoutLocally(bytes), 'local')
    } catch (error) {
      const fallback = error instanceof PhotoNotSuitableError ? configuredAiProvider() : null
      if (!fallback) throw error
      return finish(await callAi(fallback, bytes, contentType), fallback)
    }
  }

  if (configured === 'local') return finish(await cutoutLocally(bytes), 'local')

  return finish(await callAi(configured, bytes, contentType), configured)
}

function callAi(
  provider: 'gemini' | 'removebg',
  bytes: Uint8Array,
  contentType: string,
): Promise<Uint8Array> {
  return provider === 'removebg' ? removeBg(bytes, contentType) : gemini(bytes, contentType)
}

// Whatever produced the bytes — a service or our own code — they are checked
// exactly like an upload: the file decides what it is.
function finish(result: Uint8Array, provider: PhotoEditProvider): CutoutResult {
  const metadata = readImageMetadata(result)
  if (!metadata) {
    throw new PhotoEditUnavailableError('Wycinanie zwróciło coś, co nie jest obrazem')
  }

  return { bytes: result, metadata, provider }
}

async function removeBg(bytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  const form = new FormData()
  // Copied into a Buffer first: Blob wants its parts as ArrayBuffer-backed
  // values, and a Uint8Array view over a larger buffer would send the wrong
  // bytes.
  form.append('image_file', new Blob([Buffer.from(bytes)], { type: contentType }), 'photo')
  form.append('size', 'auto')
  // A transparent PNG, which is what makes a cutout usable on any background.
  form.append('format', 'png')

  const response = await call('https://api.remove.bg/v1.0/removebg', {
    body: form,
    headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY ?? '' },
    method: 'POST',
  })

  return new Uint8Array(await response.arrayBuffer())
}

async function gemini(bytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  const response = await call('https://generativelanguage.googleapis.com/v1beta/interactions', {
    body: JSON.stringify({
      input: [
        { data: Buffer.from(bytes).toString('base64'), mime_type: contentType, type: 'image' },
        { text: CUTOUT_PROMPT, type: 'text' },
      ],
      model: GEMINI_MODEL,
    }),
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY ?? '',
    },
    method: 'POST',
  })

  const image = pickGeminiImage(await response.json())
  if (!image) {
    // The model answering with words instead of a picture is a refusal or a
    // misread prompt, not a broken server.
    throw new PhotoEditUnavailableError('Model nie zwrócił obrazu — spróbuj z innym zdjęciem')
  }

  return image
}

// Pure, so the response shape is pinned by a test rather than discovered in
// production. The model may narrate before it draws, so the first image block
// is taken wherever it appears.
export function pickGeminiImage(payload: unknown): null | Uint8Array {
  const steps = (payload as { steps?: unknown })?.steps
  if (!Array.isArray(steps)) return null

  for (const step of steps) {
    const content = (step as { content?: unknown })?.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      const part = block as { data?: unknown; type?: unknown }
      if (part.type !== 'image' || typeof part.data !== 'string' || !part.data) continue
      try {
        return new Uint8Array(Buffer.from(part.data, 'base64'))
      } catch {
        return null
      }
    }
  }

  return null
}

async function call(url: string, init: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(EDIT_TIMEOUT_MS) })
  } catch {
    // Cutting out takes seconds, not milliseconds; a timeout here usually
    // means the service is struggling rather than that we asked wrongly.
    throw new PhotoEditUnavailableError('Usługa wycinania nie odpowiedziała na czas')
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error(
      `[photo-edit] ${new URL(url).host} answered ${response.status}: ${detail.slice(0, 300)}`,
    )

    // The service's own message is not passed through: it can carry the API
    // key back and is written for us, not for whoever pressed the button.
    throw new PhotoEditUnavailableError(
      response.status === 402 || response.status === 429
        ? 'Wyczerpany limit usługi wycinania. Spróbuj później.'
        : 'Usługa wycinania odpowiedziała błędem',
    )
  }

  return response
}
