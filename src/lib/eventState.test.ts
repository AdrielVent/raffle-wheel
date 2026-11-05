import { describe, expect, it } from 'vitest'
import { canDrawFromSnapshot, getPublicState } from './eventState'

describe('event state enforcement helpers', () => {
  it('returns proper state for open/closed/ended/invalid', () => {
    expect(getPublicState(null)).toBe('invalid_event')
    expect(getPublicState({ status: 'open', registration_open: true })).toBe('open')
    expect(getPublicState({ status: 'open', registration_open: false })).toBe('closed')
    expect(getPublicState({ status: 'closed', registration_open: true })).toBe('closed')
    expect(getPublicState({ status: 'ended', registration_open: false })).toBe('ended')
  })

  it('checks if snapshot has eligible entries', () => {
    expect(canDrawFromSnapshot([{ ineligible: true }, { ineligible: false }])).toBe(true)
    expect(canDrawFromSnapshot([{ ineligible: true }])).toBe(false)
  })
})
