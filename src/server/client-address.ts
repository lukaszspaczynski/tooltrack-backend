// Who is calling, as far as the network can say.
//
// Only the login throttle uses this, and that is the whole reason it has to be
// careful: a counter keyed on something the caller controls is a counter the
// caller can walk around, and one keyed on a forged value lets somebody lock
// out an address that is not theirs.
//
// So the socket is the default and `X-Forwarded-For` is read only when this
// server has been told it sits behind a proxy. In front of a proxy that header
// is a string a client typed.

// Whether TOOLTRACK_TRUST_PROXY names exactly one reverse proxy in front of
// this server. Not a count and not a list of addresses: one hop is the
// deployment this repo documents, and a knob that can express more than the
// deployment has is a knob that gets set wrong.
export function trustsProxy(): boolean {
  const raw = process.env.TOOLTRACK_TRUST_PROXY?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

// `forwardedFor` takes an array as well as a string, because node hands one
// over when the header arrives more than once — which is exactly what a client
// sending its own does in front of a proxy that adds another. Joined rather
// than picked from, so the "last entry wins" rule below sees them all in the
// order they arrived.
export function clientAddress(
  socketAddress: null | string | undefined,
  forwardedFor: null | string | string[] | undefined,
  trusted = trustsProxy(),
): string {
  const socket = normalise(socketAddress ?? '')

  if (!trusted) return socket

  // The **last** entry, not the first. nginx's `$proxy_add_x_forwarded_for`
  // appends the peer it actually saw, so a client that sends its own header
  // gets it pushed to the left and the real address is on the right. Reading
  // the first entry would mean reading whatever the attacker wrote.
  const entries = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? ''))
    .split(',')
    .map((entry) => normalise(entry))
    .filter(Boolean)

  return entries.at(-1) ?? socket
}

// `::ffff:1.2.3.4` and `1.2.3.4` are one machine, and counting them apart would
// double every limit for anybody reaching an IPv6 socket over IPv4. Brackets
// come off a literal IPv6 address for the same reason.
function normalise(address: string): string {
  const trimmed = address.trim().replace(/^\[|\]$/g, '')
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed)

  return mapped ? mapped[1] : trimmed
}
