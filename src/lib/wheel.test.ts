import { describe, expect, it } from 'vitest'
import { computeWheelRotation, entryAtPointer, nextWheelRotation, sliceLabelAngle } from './wheel'

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

  it('keeps spinning forward from the current angle and still lands on the winner', () => {
    let rotation = 0
    const draws: Array<[number, number]> = [
      [3, 8],
      [0, 7],
      [6, 7],
      [2, 3],
      [10, 11],
    ]
    for (const [index, count] of draws) {
      const next = nextWheelRotation(rotation, index, count)
      expect(next - rotation).toBeGreaterThanOrEqual(6 * 360)
      expect(next - rotation).toBeLessThan(7 * 360)
      expect(entryAtPointer(next, count)).toBe(index)
      rotation = next
    }
  })

  it('places each SVG label inside its own conic-gradient slice', () => {
    // SVG rotate(0) points to 3 o'clock; slice 0 of a 4-way wheel is centred at 45deg from 12 o'clock
    expect(sliceLabelAngle(0, 4)).toBe(-45)
    expect(sliceLabelAngle(1, 4)).toBe(45)
  })
})
