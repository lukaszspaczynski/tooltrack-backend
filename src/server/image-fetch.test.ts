import assert from 'node:assert/strict'
import test from 'node:test'

import { ImageFetchError, isBlockedAddress, isBlockedHostname, parseImageUrl } from './image-fetch'

test('loopback, private and link-local addresses are refused', () => {
  for (const address of [
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254', // the cloud metadata endpoint, the one that matters
    '100.100.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1', // loopback wearing an IPv6 hat
  ]) {
    assert.equal(isBlockedAddress(address), true, address)
  }
})

test('ordinary public addresses are allowed', () => {
  for (const address of [
    '1.1.1.1',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '2606:4700::1111',
  ]) {
    assert.equal(isBlockedAddress(address), false, address)
  }
})

test('localhost by name is refused too', () => {
  assert.equal(isBlockedHostname('localhost'), true)
  assert.equal(isBlockedHostname('LocalHost.'), true)
  assert.equal(isBlockedHostname('db.localhost'), true)
  assert.equal(isBlockedHostname('api.internal'), true)
  assert.equal(isBlockedHostname('example.com'), false)
})

test('only http and https are fetched', () => {
  assert.equal(parseImageUrl('https://example.com/a.jpg').protocol, 'https:')
  assert.equal(parseImageUrl('  http://example.com/a.jpg  ').protocol, 'http:')

  for (const raw of [
    'file:///etc/passwd',
    'data:image/png;base64,AAAA',
    'ftp://example.com/a.jpg',
    'nie-url',
  ]) {
    assert.throws(() => parseImageUrl(raw), ImageFetchError, raw)
  }
})
