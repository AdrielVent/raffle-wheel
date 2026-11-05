export const NAME_MAX_LENGTH = 100

const namePattern = /^[\p{L}\p{M}](?:[\p{L}\p{M}\s'-]{0,98}[\p{L}\p{M}])?$/u

export type NameValidationResult = {
  ok: boolean
  value: string
  message?: string
}

export function normalizeName(raw: string): string {
  return raw.trim()
}

export function validateName(raw: string, label: 'First name' | 'Last name'): NameValidationResult {
  const value = normalizeName(raw)
  if (!value) {
    return { ok: false, value, message: `${label} is required.` }
  }

  if (value.length > NAME_MAX_LENGTH) {
    return { ok: false, value, message: `${label} must be ${NAME_MAX_LENGTH} characters or less.` }
  }

  if (!namePattern.test(value)) {
    return {
      ok: false,
      value,
      message: `${label} may include letters, spaces, apostrophes, and hyphens only.`,
    }
  }

  return { ok: true, value }
}

export function validateFullName(firstName: string, lastName: string) {
  const first = validateName(firstName, 'First name')
  const last = validateName(lastName, 'Last name')

  return {
    first,
    last,
    ok: first.ok && last.ok,
  }
}
