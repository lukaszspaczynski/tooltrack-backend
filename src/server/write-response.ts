// The last step of every request: a Response written out over the Node socket.
//
// It is its own module rather than a function inside index.ts because importing
// index.ts starts a server and reaches a database. Here a test can hand in a
// fake ServerResponse and read back the status, the headers and the bytes.

import type { ServerResponse } from 'node:http'

export async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    // set-cookie is the one header that can legitimately repeat. Headers
    // collapses the rest, so a plain setHeader is right for them.
    if (key === 'set-cookie') return
    res.setHeader(key, value)
  })

  const cookies = response.headers.getSetCookie?.() ?? []
  if (cookies.length > 0) res.setHeader('set-cookie', cookies)

  if (!response.body) {
    res.end()
    return
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  res.end(bytes)
}
