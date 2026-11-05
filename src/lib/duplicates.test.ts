import { describe, expect, it } from 'vitest'
import { findDuplicateNameIds } from './duplicates'

describe('duplicate name detection', () => {
  it('flags matching names without rejecting either entry', () => {
    const duplicates = findDuplicateNameIds([
      { id: '1', first_name: 'Ana', last_name: 'Lee' },
      { id: '2', first_name: 'Ana', last_name: 'Lee' },
      { id: '3', first_name: 'Ben', last_name: 'Lee' },
    ])

    expect([...duplicates]).toEqual(['1', '2'])
  })
})
