// Registration, login and password-change bodies. Pure; see input.ts.

import { z } from 'zod'

import { NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'
import { isLang, LANGS, t, type Lang } from '../i18n'

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

// Deliberately permissive: one @, something either side, no spaces. The only
// authority on whether an address exists is whether mail reaches it, and this
// app never sends any.
const EMAIL = z
  .string({ error: () => 'email is required' })
  .trim()
  .toLowerCase()
  .min(1, { error: () => 'email is required' })
  .max(MAX_EMAIL_LENGTH, { error: () => 'email is too long' })
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { error: () => 'email is not a valid address' })

// PBKDF2 hashes any length, but an unbounded password is an unbounded amount of
// work per login attempt. Not trimmed: a space at the end of a password is a
// character somebody chose.
const password = (field: string) =>
  z
    .string({ error: () => `${field} is required` })
    .min(1, { error: () => `${field} is required` })
    .min(MIN_PASSWORD_LENGTH, {
      error: () => t('Hasło musi mieć co najmniej {n} znaków', { n: MIN_PASSWORD_LENGTH }),
    })
    .max(MAX_PASSWORD_LENGTH, {
      error: () => `${field} must be at most ${MAX_PASSWORD_LENGTH} characters`,
    })

export const REGISTER_SCHEMA = z
  .object(
    {
      displayName: z
        .string({ error: () => 'displayName must be a string' })
        .trim()
        .max(MAX_DISPLAY_NAME_LENGTH, {
          error: () => `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
        })
        .optional(),
      email: EMAIL,
      password: password('password'),
    },
    NOT_AN_OBJECT,
  )
  .strip()

// Login checks that the fields are present, not that they are well formed.
// Telling somebody their address "looks wrong" at sign-in leaks which addresses
// this instance considers acceptable, and the answer is the same either way —
// which is why this schema is not REGISTER_SCHEMA with the name removed.
export const LOGIN_SCHEMA = z
  .object(
    {
      email: z.string().trim().toLowerCase().min(1),
      password: z.string().min(1),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export const PASSWORD_CHANGE_SCHEMA = z
  .object(
    {
      currentPassword: z
        .string({ error: () => 'currentPassword is required' })
        .min(1, { error: () => 'currentPassword is required' }),
      newPassword: password('newPassword'),
    },
    NOT_AN_OBJECT,
  )
  .strip()
  .refine((value) => value.newPassword !== value.currentPassword, {
    error: () => 'newPassword must differ from the current password',
  })

// The language the client wants this account to read in. An unknown tag is
// refused rather than quietly turned into Polish: the screen asked for
// something specific, and a silent answer would look like it worked.
export const LANGUAGE_SCHEMA = z
  .object(
    {
      language: z.enum(LANGS, { error: () => `language must be one of: ${LANGS.join(', ')}` }),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseRegisterInput(body: unknown): Parsed<RegisterInput> {
  const parsed = parseWith(REGISTER_SCHEMA, body)
  if (!parsed.ok) return parsed

  return valid({
    // Nobody has to type a name to get an account. The part before the @ is a
    // better placeholder than an empty row in the admin user list.
    displayName: parsed.value.displayName || parsed.value.email.split('@')[0],
    email: parsed.value.email,
    password: parsed.value.password,
  })
}

export function parseLoginInput(body: unknown): Parsed<LoginInput> {
  const parsed = parseWith(LOGIN_SCHEMA, body)

  // One message whatever was missing, for the same reason the schema is
  // permissive: what went wrong at sign-in is nobody's business but the caller's.
  return parsed.ok ? parsed : { error: 'Email and password are required', ok: false }
}

export function parsePasswordChangeInput(body: unknown): Parsed<PasswordChangeInput> {
  return parseWith(PASSWORD_CHANGE_SCHEMA, body)
}

export function parseLanguageInput(body: unknown): Parsed<Lang> {
  const parsed = parseWith(LANGUAGE_SCHEMA, body)

  return parsed.ok ? valid(parsed.value.language) : parsed
}

export { isLang }
