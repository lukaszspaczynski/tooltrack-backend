// Fetching an image the user pointed at — a pasted URL, or one picked from the
// search suggestions.
//
// This is the one place in the product where the server makes a request to an
// address someone else chose, so it is the one place that can be talked into
// reaching something it should not: a database on localhost, a metadata
// endpoint on a cloud instance, a printer on the office network. Everything
// below is about refusing that, and about not swallowing a five-gigabyte
// "image".

import { lookup } from 'node:dns/promises'

import { readImageMetadata, type ImageMetadata } from './image-metadata'

export const DEFAULT_MAX_PHOTO_BYTES = 10 * 1024 * 1024

const FETCH_TIMEOUT_MS = 10_000

// Sent on every outbound request. Some hosts — Wikimedia among them — answer
// 400 to a client that does not identify itself, and an operator reading their
// own access log deserves to see who is asking.
const USER_AGENT = 'ToolTrack/0.1 (tool catalog; +https://github.com/)'

export class ImageFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageFetchError'
  }
}

export type FetchedImage = {
  bytes: Uint8Array
  metadata: ImageMetadata
  sourceUrl: string
}

export function maxPhotoBytes(): number {
  const raw = process.env.TOOLTRACK_MAX_PHOTO_BYTES
  if (!raw?.trim()) return DEFAULT_MAX_PHOTO_BYTES

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_PHOTO_BYTES
  return parsed
}

export function parseImageUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new ImageFetchError('To nie jest poprawny adres URL')
  }

  // http(s) only. file:, data: and gopher: are all ways of asking the server
  // to read something that is not on the web.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageFetchError('Adres musi zaczynać się od http:// albo https://')
  }

  return url
}

// Literal addresses that must never be reached, whether they arrive as the
// hostname or as the result of resolving one. Pure, so the table can be read
// and tested without a network.
export function isBlockedAddress(address: string): boolean {
  const value = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')

  if (value === '' || value === '::' || value === '::1' || value === 'localhost') return true

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) is the same address wearing a hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (mapped) return isBlockedAddress(mapped[1])

  if (value.includes(':')) {
    // fc00::/7 unique local, fe80::/10 link local.
    return /^f[cd]/.test(value) || /^fe[89ab]/.test(value)
  }

  const octets = value.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false
  }

  const [a, b] = octets

  if (a === 0) return true // this network
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link local, and 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // carrier NAT
  if (a >= 224) return true // multicast and reserved

  return false
}

export function isBlockedHostname(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.internal'))
    return true
  return isBlockedAddress(value)
}

export async function assertPublicHost(url: URL): Promise<void> {
  if (isBlockedHostname(url.hostname)) {
    throw new ImageFetchError('Adres wskazuje na sieć lokalną')
  }

  // The hostname alone is not enough: a public name can resolve to 127.0.0.1.
  // Every address it resolves to has to be acceptable.
  //
  // This is checked before the request, and the name could in principle
  // resolve differently when the request is made. Closing that gap means
  // dialling the address ourselves; for a tool catalog behind a login, the
  // check plus the protocol and size limits is the proportionate answer.
  let addresses: { address: string }[]
  try {
    addresses = await lookup(url.hostname, { all: true })
  } catch {
    throw new ImageFetchError('Nie udało się rozwiązać adresu')
  }

  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new ImageFetchError('Adres wskazuje na sieć lokalną')
  }
}

export async function fetchRemoteImage(
  raw: string,
  limit = maxPhotoBytes(),
): Promise<FetchedImage> {
  const url = parseImageUrl(raw)
  await assertPublicHost(url)

  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'image/*', 'user-agent': USER_AGENT },
      // No cookies, no credentials, and no following a redirect into somewhere
      // the host check never saw.
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new ImageFetchError('Nie udało się pobrać pliku spod tego adresu')
  }

  if (!response.ok) {
    throw new ImageFetchError(`Serwer odpowiedział ${response.status}`)
  }

  // Redirects are followed, so where the bytes actually came from is checked
  // again here rather than only at the start.
  const finalUrl = new URL(response.url || url.toString())
  if (isBlockedHostname(finalUrl.hostname)) {
    throw new ImageFetchError('Przekierowanie prowadzi do sieci lokalnej')
  }

  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) {
    throw new ImageFetchError(`Plik jest większy niż ${Math.round(limit / 1024 / 1024)} MB`)
  }

  const bytes = await readCapped(response, limit)
  const metadata = readImageMetadata(bytes)
  // The decisive check. A content-type header is a claim by the other side;
  // this is the file itself.
  if (!metadata) throw new ImageFetchError('Ten plik nie jest obrazem JPEG, PNG, GIF ani WebP')

  return { bytes, metadata, sourceUrl: finalUrl.toString() }
}

async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) throw new ImageFetchError('Pusta odpowiedź')

  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > limit) {
      // Stop pulling rather than discover the size after buffering it all.
      await reader.cancel()
      throw new ImageFetchError(`Plik jest większy niż ${Math.round(limit / 1024 / 1024)} MB`)
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}
