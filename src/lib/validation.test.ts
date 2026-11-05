import { describe, expect, it } from 'vitest'
import { validateFullName, validateName } from './validation'

describe('name validation', () => {
  it('accepts unicode letters, spaces, apostrophes, and hyphens', () => {
    expect(validateName("  Élodie-Anne  ", 'First name')).toEqual({ ok: true, value: 'Élodie-Anne' })
    expect(validateName("O'Connor", 'Last name')).toEqual({ ok: true, value: "O'Connor" })
    expect(validateName('李 小龍', 'First name')).toEqual({ ok: true, value: '李 小龍' })
  })

  it('rejects invalid characters and empty values', () => {
    expect(validateName('', 'First name').ok).toBe(false)
    expect(validateName('Alex1', 'First name').ok).toBe(false)
  })

  it('validates both fields together', () => {
    expect(validateFullName(' Jane ', ' Doe ').ok).toBe(true)
    expect(validateFullName('Jane', 'Doe!').ok).toBe(false)
  })
})
