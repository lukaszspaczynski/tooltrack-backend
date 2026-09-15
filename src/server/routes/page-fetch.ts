// Fetching a product page, for whichever importer is about to read it.
//
// Shared by the item import and the case import rather than written twice: the
// two read different pages into different shapes, but "get me this page without
// letting a shop hold the request open or fill the process" is the same job,
// and a timeout that existed in one of them and not the other would be a bug
// nobody noticed until a site hung.

// A product page is text; a site that answers with a hundred megabytes of
// something else is a site that is not answering.
const MAX_PAGE_BYTES = 4_000_000
const PAGE_TIMEOUT_MS = 20_000

// The page, as text, with both ends of the rope tied: a timeout, so a shop
// that never answers does not hold the request open, and a ceiling, so one
// that answers forever does not fill the process.
export async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      // Shops answer a bare fetch with a challenge page; saying who this is
      // gets the product card, which is what was asked for.
      'user-agent': 'ToolTrack/0.1 (+catalog importer)',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_PAGE_BYTES) throw new Error('page too large')

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error('page too large')

  return new TextDecoder('utf-8').decode(bytes)
}
