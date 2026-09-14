import assert from 'node:assert/strict'
import test from 'node:test'

import {
  forgetFailedLogins,
  loginAttemptAllowed,
  recordFailedLogin,
  resetLoginThrottle,
} from './login-throttle'

const MINUTE = 60 * 1000

// The clock is a parameter throughout, so a window that closes is a number
// here rather than a test that sleeps for a quarter of an hour.
function at(minutes: number): number {
  return 1_000_000_000_000 + minutes * MINUTE
}

test.beforeEach(() => {
  resetLoginThrottle()
})

test('a handful of wrong passwords is not an attack', () => {
  const attempt = { address: '10.0.0.5', email: 'ola@example.com' }

  for (let i = 0; i < 9; i += 1) recordFailedLogin(attempt, at(i))

  assert.equal(loginAttemptAllowed(attempt, at(9)).allowed, true)
})

test('the tenth failure against one e-mail closes it', () => {
  const attempt = { address: '10.0.0.5', email: 'ola@example.com' }

  for (let i = 0; i < 10; i += 1) recordFailedLogin(attempt, at(i))

  const decision = loginAttemptAllowed(attempt, at(10))
  assert.equal(decision.allowed, false)
  assert.ok(decision.allowed === false && decision.retryAfterSeconds > 0)
})

test('the window is what reopens it, and Retry-After says when', () => {
  const attempt = { address: '10.0.0.5', email: 'ola@example.com' }
  for (let i = 0; i < 10; i += 1) recordFailedLogin(attempt, at(i))

  // The oldest failure was at minute 0, so a fifteen-minute window frees a slot
  // five minutes after minute 10.
  const decision = loginAttemptAllowed(attempt, at(10))
  assert.ok(decision.allowed === false)
  assert.equal(decision.retryAfterSeconds, 5 * 60)

  assert.equal(loginAttemptAllowed(attempt, at(15)).allowed, true)
})

test('being refused does not extend the block', () => {
  // Otherwise somebody hammering an address could hold a colleague's account
  // shut for as long as they cared to keep going — a denial of service dressed
  // as a defence.
  const attempt = { address: '10.0.0.5', email: 'ola@example.com' }
  for (let i = 0; i < 10; i += 1) recordFailedLogin(attempt, at(i))

  for (let i = 10; i < 30; i += 1) loginAttemptAllowed(attempt, at(i))

  assert.equal(loginAttemptAllowed(attempt, at(15)).allowed, true)
})

test('one account tried once each is caught by the address, not the e-mail', () => {
  // The e-mail counter cannot see this attack at all: fifty accounts tried
  // once is one failure per e-mail. It is the whole reason there are two.
  const address = '198.51.100.7'

  for (let i = 0; i < 50; i += 1) {
    recordFailedLogin({ address, email: `ktos${i}@example.com` }, at(i / 10))
  }

  assert.equal(loginAttemptAllowed({ address, email: 'ola@example.com' }, at(6)).allowed, false)
  // Somebody else, somewhere else, is unaffected.
  assert.equal(
    loginAttemptAllowed({ address: '10.0.0.5', email: 'ola@example.com' }, at(6)).allowed,
    true,
  )
})

test('signing in clears the e-mail counter and leaves the address one', () => {
  // Clearing both would let somebody who holds one valid account reset their
  // address counter whenever it filled up, and go back to guessing at
  // everybody else's.
  const address = '198.51.100.7'
  const mine = { address, email: 'moje@example.com' }

  for (let i = 0; i < 50; i += 1) {
    recordFailedLogin({ address, email: `ktos${i}@example.com` }, at(i / 10))
  }
  for (let i = 0; i < 5; i += 1) recordFailedLogin(mine, at(6))

  forgetFailedLogins(mine)

  // The e-mail is forgiven; the address is still over its limit.
  assert.equal(loginAttemptAllowed(mine, at(6)).allowed, false)
  assert.equal(
    loginAttemptAllowed({ address: '10.0.0.5', email: 'moje@example.com' }, at(6)).allowed,
    true,
  )
})

test('an e-mail nobody has an account for is counted like one that exists', () => {
  // The throttle runs before the lookup and keys on what was submitted, so the
  // two cannot be told apart by how they are refused. Telling them apart is
  // how a login form becomes a way to list the addresses registered here.
  const attempt = { address: '10.0.0.5', email: 'nikt@example.com' }

  for (let i = 0; i < 10; i += 1) recordFailedLogin(attempt, at(i))

  assert.equal(loginAttemptAllowed(attempt, at(10)).allowed, false)
})

test('a caller the socket could not name does not become one shared bucket', () => {
  // An empty address is not an address. Counting every such caller together
  // would mean one of them could lock out the rest.
  for (let i = 0; i < 60; i += 1)
    recordFailedLogin({ address: '', email: `a${i}@x.test` }, at(i / 10))

  assert.equal(loginAttemptAllowed({ address: '', email: 'ola@example.com' }, at(6)).allowed, true)
})
