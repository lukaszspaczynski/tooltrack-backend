// Registration, login and password-change bodies. Pure; see input.ts.

import { invalid, isPlainObject, trimmedString, valid, type Parsed } from './input'
import { t } from '../i18n'

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 200
export const MAX_EMAIL_LENGTH = 320
export const MAX_DISPLAY_NAME_LENGTH = 100

export type RegisterInput = {
  displayName: string
  email: string
  password: string
}

export type LoginInput = {
  email: string
  password: string
}

export type PasswordChangeInput = {
  currentPassword: string
  newPassword: string
}

export function parseRegisterInput(body: unknown): Parsed<RegisterInput> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const email = parseEmail(body.email)
  if (!email.ok) return invalid(email.error)

  const password = parsePassword(body.password, 'password')
  if (!password.ok) return invalid(password.error)

  const displayName = trimmedString(body.displayName) ?? ''
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return invalid(`displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`)
  }

  return valid({
    // Nobody has to type a name to get an account. The part before the @ is a
    // better placeholder than an empty row in the admin user list.
    displayName: displayName || email.value.split('@')[0],
    email: email.value,
    password: password.value,
  })
}

export function parseLoginInput(body: unknown): Parsed<LoginInput> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const email = trimmedString(body.email)?.toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''

  // Login checks that the fields are present, not that they are well formed.
  // Telling someone their email "looks wrong" at sign-in leaks which addresses
  // this instance considers acceptable, and the answer is the same either way.
  if (!email || !password) return invalid('Email and password are required')

  return valid({ email, password })
}

export function parsePasswordChangeInput(body: unknown): Parsed<PasswordChangeInput> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  if (!currentPassword) return invalid('currentPassword is required')

  const newPassword = parsePassword(body.newPassword, 'newPassword')
  if (!newPassword.ok) return invalid(newPassword.error)

  if (newPassword.value === currentPassword) {
    return invalid('newPassword must differ from the current password')
  }

  return valid({ currentPassword, newPassword: newPassword.value })
}

function parseEmail(value: unknown): Parsed<string> {
  const email = trimmedString(value)?.toLowerCase()
  if (!email) return invalid('email is required')
  if (email.length > MAX_EMAIL_LENGTH) return invalid('email is too long')

  // Deliberately permissive: one @, something either side, no spaces. The only
  // authority on whether an address exists is whether mail reaches it, and
  // this app never sends any.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid('email is not a valid address')

  return valid(email)
}

function parsePassword(value: unknown, field: string): Parsed<string> {
  if (typeof value !== 'string' || value.length === 0) return invalid(`${field} is required`)
  if (value.length < MIN_PASSWORD_LENGTH) {
    return invalid(t('Hasło musi mieć co najmniej {n} znaków', { n: MIN_PASSWORD_LENGTH }))
  }
  // PBKDF2 hashes any length, but an unbounded password is an unbounded amount
  // of work per login attempt.
  if (value.length > MAX_PASSWORD_LENGTH) {
    return invalid(`${field} must be at most ${MAX_PASSWORD_LENGTH} characters`)
  }

  return valid(value)
}
