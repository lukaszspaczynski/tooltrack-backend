import assert from 'node:assert/strict'
import test from 'node:test'

import { clientAddress } from './client-address'

test('without a proxy the socket is the only thing believed', () => {
  // X-Forwarded-For in front of a proxy is a string the caller typed. Reading
  // it would let somebody spend a colleague's login attempts, or spread their
  // own over as many addresses as they cared to invent.
  assert.equal(clientAddress('203.0.113.9', '198.51.100.1', false), '203.0.113.9')
  assert.equal(clientAddress('203.0.113.9', undefined, false), '203.0.113.9')
})

test('behind one proxy the last entry wins, not the first', () => {
  // nginx appends the peer it actually saw, so a client that sends its own
  // header pushes it to the left. The first entry is whatever the attacker
  // wrote; the right-hand one is the address the proxy observed.
  assert.equal(clientAddress('10.0.0.2', '198.51.100.1, 203.0.113.9', true), '203.0.113.9')
  assert.equal(clientAddress('10.0.0.2', 'złośliwe, 203.0.113.9', true), '203.0.113.9')
})

test('a header sent twice is read in the order it arrived', () => {
  // node hands over an array when the header repeats, which is exactly what a
  // client sending its own produces in front of a proxy that adds another.
  assert.equal(clientAddress('10.0.0.2', ['198.51.100.1', '203.0.113.9'], true), '203.0.113.9')
})

test('a trusted proxy that sent no header falls back to the socket', () => {
  // A misconfigured proxy should read as "the proxy", which is one bucket for
  // everybody behind it — noticeable — rather than as no address at all.
  assert.equal(clientAddress('10.0.0.2', undefined, true), '10.0.0.2')
  assert.equal(clientAddress('10.0.0.2', '  ,  ', true), '10.0.0.2')
})

test('one machine is one address however the socket spells it', () => {
  // ::ffff:1.2.3.4 and 1.2.3.4 are the same caller reaching an IPv6 socket
  // over IPv4. Two keys would mean twice the attempts.
  assert.equal(clientAddress('::ffff:203.0.113.9', undefined, false), '203.0.113.9')
  assert.equal(clientAddress('[2001:db8::1]', undefined, false), '2001:db8::1')
})

test('a socket that named nobody is empty rather than invented', () => {
  assert.equal(clientAddress(undefined, undefined, false), '')
  assert.equal(clientAddress(null, null, true), '')
})
