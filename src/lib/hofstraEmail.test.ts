import { describe, expect, it } from 'vitest'
import { normalizeHofstraUsername } from './hofstraEmail'

describe('Hofstra username normalization', () => {
  it('builds full email from username input', () => {
    expect(normalizeHofstraUsername('aventura2')).toEqual({
      ok: true,
      username: 'aventura2',
      email: 'aventura2@hofstra.edu',
    })
  })

  it('accepts pasted full Hofstra address and strips suffix', () => {
    expect(normalizeHofstraUsername('Aventura2@hofstra.edu')).toEqual({
      ok: true,
      username: 'aventura2',
      email: 'aventura2@hofstra.edu',
    })
  })

  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeHofstraUsername('  AVENTURA2  ')).toEqual({
      ok: true,
      username: 'aventura2',
      email: 'aventura2@hofstra.edu',
    })
  })

  it('rejects invalid domains and malformed values', () => {
    expect(normalizeHofstraUsername('aventura2@gmail.com').ok).toBe(false)
    expect(normalizeHofstraUsername('av en').ok).toBe(false)
    expect(normalizeHofstraUsername('a@b@hofstra.edu').ok).toBe(false)
    expect(normalizeHofstraUsername(' ').ok).toBe(false)
  })
})
