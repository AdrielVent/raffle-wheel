const HOFSTRA_DOMAIN = 'hofstra.edu'

export type HofstraEmailValidationResult = {
  ok: boolean
  username: string
  email: string
  message?: string
}

export function normalizeHofstraUsername(raw: string): HofstraEmailValidationResult {
  const trimmed = raw.trim()

  if (!trimmed) {
    return {
      ok: false,
      username: '',
      email: '',
      message: 'Hofstra email username is required.',
    }
  }

  if (/\s/.test(trimmed)) {
    return {
      ok: false,
      username: '',
      email: '',
      message: 'Hofstra email username cannot include spaces.',
    }
  }

  const atCount = (trimmed.match(/@/g) ?? []).length
  if (atCount > 1) {
    return {
      ok: false,
      username: '',
      email: '',
      message: 'Enter a valid Hofstra email username.',
    }
  }

  let username = trimmed

  if (atCount === 1) {
    const [candidateUsername, candidateDomain] = trimmed.split('@')
    if (!candidateUsername || !candidateDomain) {
      return {
        ok: false,
        username: '',
        email: '',
        message: 'Enter a valid Hofstra email username.',
      }
    }

    if (candidateDomain.toLocaleLowerCase() !== HOFSTRA_DOMAIN) {
      return {
        ok: false,
        username: '',
        email: '',
        message: 'Please use a @hofstra.edu address.',
      }
    }

    username = candidateUsername
  }

  const normalizedUsername = username.trim().toLocaleLowerCase()
  if (!normalizedUsername || normalizedUsername.includes('@') || /\s/.test(normalizedUsername)) {
    return {
      ok: false,
      username: '',
      email: '',
      message: 'Enter a valid Hofstra email username.',
    }
  }

  return {
    ok: true,
    username: normalizedUsername,
    email: `${normalizedUsername}@${HOFSTRA_DOMAIN}`,
  }
}
