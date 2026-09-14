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
import type { ErrorCode } from './error-codes'
import { readImageMetadata, type ImageMetadata } from './image-metadata'
import { t } from './i18n'

// Which methods this installation allows, and the keys behind them. There is
// no single configured "mode" any more: an admin says which methods may be
// used, and the person in front of the cutout screen picks one of those.
export type PhotoEditProvider = 'gemini' | 'local' | 'removebg'

export type PhotoEditConfig = {
  allowed: PhotoEditProvider[]
  geminiKey: string
  removeBgKey: string
  threshold?: number
}

export type CutoutResult = {
  bytes: Uint8Array
  metadata: ImageMetadata
  // Which method actually produced these bytes. With `auto` that is not known
  // until it has run.
  provider: PhotoEditProvider
}

// What one run may change: which of the allowed methods to use, and the knobs
// that method has.
export type CutoutOverrides = {
  method?: PhotoEditProvider
  padding?: number
  // remove.bg's own hint about what is in the picture. 'product' is what a
  // tool on a bench is; 'auto' lets the service decide.
  removeBgType?: 'auto' | 'product'
  threshold?: number
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
  readonly code: ErrorCode

  constructor(message: string) {
    super(message)
    this.name = 'PhotoEditUnavailableError'
    this.code = 'CUTOUT_UNAVAILABLE'
  }
}

// A method has to be one the installation allows. Checked before any bytes
// move, and in one place, so neither the settings screen nor the cutout screen
// can talk the server into spending a key it was told not to use.
export function assertAllowed(config: PhotoEditConfig, provider: PhotoEditProvider): void {
  if (config.allowed.includes(provider)) return

  throw new PhotoEditUnavailableError(
    t('Metoda {provider} nie jest dostępna — włącz ją i uzupełnij klucz w Ustawieniach', {
      provider,
    }),
  )
}

function keyFor(config: PhotoEditConfig, provider: 'gemini' | 'removebg'): string {
  return (provider === 'removebg' ? config.removeBgKey : config.geminiKey).trim()
}

export async function cutoutSubject(
  bytes: Uint8Array,
  contentType: string,
  config: PhotoEditConfig,
  overrides: CutoutOverrides = {},
): Promise<CutoutResult> {
  if (config.allowed.length === 0) {
    throw new PhotoEditUnavailableError(
      t('Żadna metoda wycinania nie jest włączona — sprawdź Ustawienia'),
    )
  }

  // No method named: the local one when it is allowed, otherwise whatever is.
  // There is deliberately no "try the free one and fall back to a paid one"
  // strategy — the cutout screen shows the refusal and the person decides
  // whether this photo is worth a paid call.
  const method =
    overrides.method ?? (config.allowed.includes('local') ? 'local' : config.allowed[0])

  assertAllowed(config, method)

  if (method === 'local') {
    return finish(
      await cutoutLocally(bytes, {
        padding: overrides.padding,
        threshold: overrides.threshold ?? config.threshold,
      }),
      'local',
    )
  }

  return finish(await callAi(method, bytes, contentType, config, overrides), method)
}

function callAi(
  provider: 'gemini' | 'removebg',
  bytes: Uint8Array,
  contentType: string,
  config: PhotoEditConfig,
  overrides: CutoutOverrides,
): Promise<Uint8Array> {
  return provider === 'removebg'
    ? removeBg(bytes, contentType, keyFor(config, 'removebg'), overrides.removeBgType ?? 'auto')
    : gemini(bytes, contentType, keyFor(config, 'gemini'))
}

// Whatever produced the bytes — a service or our own code — they are checked
// exactly like an upload: the file decides what it is.
function finish(result: Uint8Array, provider: PhotoEditProvider): CutoutResult {
  const metadata = readImageMetadata(result)
  if (!metadata) {
    throw new PhotoEditUnavailableError(t('Wycinanie zwróciło coś, co nie jest obrazem'))
  }

  return { bytes: result, metadata, provider }
}

async function removeBg(
  bytes: Uint8Array,
  contentType: string,
  apiKey: string,
  type: 'auto' | 'product',
): Promise<Uint8Array> {
  const form = new FormData()
  // Copied into a Buffer first: Blob wants its parts as ArrayBuffer-backed
  // values, and a Uint8Array view over a larger buffer would send the wrong
  // bytes.
  form.append('image_file', new Blob([Buffer.from(bytes)], { type: contentType }), 'photo')
  form.append('size', 'auto')
  // Telling the service it is looking at a product rather than letting it
  // guess measurably helps on tools photographed on a bench.
  form.append('type', type)
  // A transparent PNG, which is what makes a cutout usable on any background.
  form.append('format', 'png')

  const response = await call('https://api.remove.bg/v1.0/removebg', {
    body: form,
    headers: { 'X-Api-Key': apiKey },
    method: 'POST',
  })

  return new Uint8Array(await response.arrayBuffer())
}

async function gemini(bytes: Uint8Array, contentType: string, apiKey: string): Promise<Uint8Array> {
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
      'x-goog-api-key': apiKey,
    },
    method: 'POST',
  })

  const image = pickGeminiImage(await response.json())
  if (!image) {
    // The model answering with words instead of a picture is a refusal or a
    // misread prompt, not a broken server.
    throw new PhotoEditUnavailableError(t('Model nie zwrócił obrazu — spróbuj z innym zdjęciem'))
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
    throw new PhotoEditUnavailableError(t('Usługa wycinania nie odpowiedziała na czas'))
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
        ? t('Wyczerpany limit usługi wycinania. Spróbuj później.')
        : t('Usługa wycinania odpowiedziała błędem'),
    )
  }

  return response
}
