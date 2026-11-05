import { describe, expect, it } from 'vitest'
import { computeWheelRotation, entryAtPointer } from './wheel'

describe('wheel calculations', () => {
  it('lands on target entry', () => {
    const count = 12
    const targetIndex = 7
    const rotation = computeWheelRotation(targetIndex, count, 0)
    expect(entryAtPointer(rotation, count)).toBe(targetIndex)
  })

  it('handles empty wheels', () => {
    expect(computeWheelRotation(0, 0)).toBe(0)
    expect(entryAtPointer(120, 0)).toBe(-1)
  })
})
