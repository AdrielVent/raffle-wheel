import { describe, expect, it } from 'vitest'
import { findDuplicateNameIds } from './duplicates'

describe('duplicate name detection', () => {
  it('flags matching names even when emails differ, without rejecting either entry', () => {
    const duplicates = findDuplicateNameIds([
      { id: '1', first_name: 'Ana', last_name: 'Lee', hofstra_email: 'ana1@hofstra.edu' },
      { id: '2', first_name: 'Ana', last_name: 'Lee', hofstra_email: 'ana2@hofstra.edu' },
      { id: '3', first_name: 'Ben', last_name: 'Lee', hofstra_email: 'ben@hofstra.edu' },
    ])

    expect([...duplicates]).toEqual(['1', '2'])
  })
})
