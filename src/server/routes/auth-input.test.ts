import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIN_PASSWORD_LENGTH,
  parseLoginInput,
  parseLanguageInput,
  parsePasswordChangeInput,
  parseRegisterInput,
} from './auth-input'

test('registration lowercases the email and defaults the display name', () => {
  const parsed = parseRegisterInput({ email: '  Ola@Example.COM ', password: 'sekret1234' })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.email, 'ola@example.com')
  assert.equal(parsed.value.displayName, 'ola')
})

test('registration refuses an address that is not one', () => {
  for (const email of ['', 'ola', 'ola@example', 'ola @example.com', 'a@b@c.com']) {
    assert.equal(parseRegisterInput({ email, password: 'sekret1234' }).ok, false, email)
  }
})

test('registration enforces a minimum password length', () => {
  const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1)
  assert.equal(parseRegisterInput({ email: 'ola@example.com', password: short }).ok, false)

  const long = 'x'.repeat(201)
  assert.equal(parseRegisterInput({ email: 'ola@example.com', password: long }).ok, false)
})

test('login only checks that both fields are there', () => {
  const parsed = parseLoginInput({ email: ' OLA@example.com ', password: 'x' })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.email, 'ola@example.com')
  // Deliberately not rejected for being short: the answer to a bad password is
  // 401, and a 400 here would say the account exists but the input was wrong.
  assert.equal(parsed.value.password, 'x')

  assert.equal(parseLoginInput({ email: 'ola@example.com' }).ok, false)
  assert.equal(parseLoginInput('ola').ok, false)
})

test('a password change needs the current one and a different new one', () => {
  assert.equal(parsePasswordChangeInput({ newPassword: 'sekret1234' }).ok, false)
  assert.equal(
    parsePasswordChangeInput({ currentPassword: 'sekret1234', newPassword: 'sekret1234' }).ok,
    false,
  )

  const parsed = parsePasswordChangeInput({
    currentPassword: 'sekret1234',
    newPassword: 'inne-haslo-9',
  })
  assert.ok(parsed.ok)
})

test('a language has to be one this interface speaks', () => {
  // Turning an unknown tag into Polish silently would look to the screen like
  // the change went through, and the next reload would undo it.
  assert.equal(parseLanguageInput({ language: 'en' }).ok, true)
  assert.equal(parseLanguageInput({ language: 'pl' }).ok, true)
  assert.equal(parseLanguageInput({ language: 'de' }).ok, false)
  assert.equal(parseLanguageInput({ language: 'EN' }).ok, false)
  assert.equal(parseLanguageInput({ language: '' }).ok, false)
  assert.equal(parseLanguageInput({}).ok, false)
  assert.equal(parseLanguageInput(null).ok, false)
  assert.equal(parseLanguageInput('en').ok, false)

  const parsed = parseLanguageInput({ language: 'en' })
  assert.ok(parsed.ok)
  assert.equal(parsed.value, 'en')
})
