// How many times one address, or one e-mail, may fail to sign in.
//
// Nothing else in this API needs a rate limit: every other route asks for a
// session first, so the worst an unauthenticated caller can do is be refused.
// Login is the exception — it is the one place where guessing is the attack,
// and it was free until this existed.
//
// Two counters, because they answer different questions. The **e-mail** one
// stops somebody working through a password list against one account. The
// **address** one stops them working through an account list, which the e-mail
// counter cannot see at all: a hundred accounts tried once each is one failure
// per e-mail.
//
// In memory, deliberately. The alternative is a table, and a table written by
// unauthenticated requests is itself something to defend — the attacker
// chooses how many rows to insert. This map is bounded, costs nothing, and is
// lost on a restart, which an attacker cannot cause. What it does not survive
// is a second replica: two of them mean two counters and twice the attempts.
// The deployment this repo documents is one container; if that changes, this
// is the module to move into Postgres, and the shape of it is already the
// shape a table would have.

const WINDOW_MS = 15 * 60 * 1000

// A person who has forgotten which of two passwords it was needs several
// tries; nobody needs ten. The address is allowed more because a crew behind
// one office router is one address, and a shared address that locks out on the
// third fumble is a support call every week.
const LIMITS = { address: 50, email: 10 } as const

// Enough for every address a small installation sees in a window, and a
// ceiling so that a caller rotating e-mails cannot grow this without end. When
// it is reached the expired entries go first, and only then the oldest — so
// the pressure falls on whoever is currently flooding rather than on a key
// that is about to matter.
const MAX_TRACKED_KEYS = 20_000

export type LoginAttempt = { address: string; email: string }

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

const failures = new Map<string, number[]>()

// Whether this attempt may be checked against a password at all.
//
// Refusing does **not** record anything. If it did, somebody hammering an
// address could hold a colleague's account shut for as long as they cared to
// keep going, which is a denial of service dressed as a defence — so the block
// always expires a window after the last attempt that was actually tried.
export function loginAttemptAllowed(
  attempt: LoginAttempt,
  now: number = Date.now(),
): ThrottleDecision {
  let oldest = Infinity

  for (const [key, limit] of keysOf(attempt)) {
    const recent = recentFailures(key, now)
    if (recent.length < limit) continue

    oldest = Math.min(oldest, recent[0])
  }

  if (oldest === Infinity) return { allowed: true }

  return {
    allowed: false,
    // When the oldest failure still counted falls out of the window, there is
    // room for one more try. Rounded up, so a client that waits exactly this
    // long is not refused again by a millisecond.
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
  }
}

export function recordFailedLogin(attempt: LoginAttempt, now: number = Date.now()): void {
  for (const [key] of keysOf(attempt)) {
    const recent = recentFailures(key, now)
    recent.push(now)
    failures.set(key, recent)
  }

  if (failures.size > MAX_TRACKED_KEYS) evict(now)
}

// Signing in clears the **e-mail** counter and leaves the address one.
//
// Clearing both would be the obvious thing and it is a hole: somebody who
// holds one valid account of their own could sign in with it whenever their
// address counter filled up, and go back to guessing at everyone else's with
// the limit reset. The e-mail counter is safe to clear, because clearing it
// takes knowing that account's password.
export function forgetFailedLogins(attempt: LoginAttempt): void {
  failures.delete(`email:${attempt.email}`)
}

// Tests only. The map is module state on purpose — there is one server — and
// this is what keeps one test from being able to fail another.
export function resetLoginThrottle(): void {
  failures.clear()
}

function keysOf(attempt: LoginAttempt): [string, number][] {
  const keys: [string, number][] = []

  // An empty address means the socket said nothing, which should not turn
  // every such caller into one shared bucket.
  if (attempt.address) keys.push([`address:${attempt.address}`, LIMITS.address])
  if (attempt.email) keys.push([`email:${attempt.email}`, LIMITS.email])

  return keys
}

// Oldest first, which is what makes `recent[0]` the one that frees a slot.
function recentFailures(key: string, now: number): number[] {
  const all = failures.get(key)
  if (!all) return []

  const recent = all.filter((at) => at > now - WINDOW_MS)
  if (recent.length === 0) failures.delete(key)

  return recent
}

function evict(now: number): void {
  for (const [key, times] of failures) {
    if (times.every((at) => at <= now - WINDOW_MS)) failures.delete(key)
  }

  // Map iterates in insertion order, so this drops the keys that have been
  // tracked longest.
  for (const key of failures.keys()) {
    if (failures.size <= MAX_TRACKED_KEYS) break
    failures.delete(key)
  }
}
