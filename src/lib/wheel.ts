// Wheel geometry
// - Slices are laid out clockwise starting at 12 o'clock (CSS conic-gradient default).
// - The pointer sits at 12 o'clock.
// - Rotating the wheel clockwise by R degrees brings the slice centred at (360 - R) under the pointer.

export const WHEEL_SPIN_MS = 4000

export function computeWheelRotation(targetIndex: number, count: number, spins = 6): number {
  if (count <= 0) {
    return 0
  }

  const normalizedIndex = ((targetIndex % count) + count) % count
  const slice = 360 / count
  const center = normalizedIndex * slice + slice / 2
  return spins * 360 + (360 - center)
}

/**
 * Rotation for the next spin, continuing from the wheel's current rotation so every
 * draw visibly spins `spins` full turns before landing on the winner's slice.
 */
export function nextWheelRotation(current: number, targetIndex: number, count: number, spins = 6): number {
  if (count <= 0) {
    return current
  }
  const landing = ((computeWheelRotation(targetIndex, count, 0) % 360) + 360) % 360
  const currentMod = ((current % 360) + 360) % 360
  const delta = (landing - currentMod + 360) % 360
  return current + spins * 360 + delta
}

export function entryAtPointer(rotationDeg: number, count: number): number {
  if (count <= 0) {
    return -1
  }

  const normalized = ((rotationDeg % 360) + 360) % 360
  const pointerAngle = (360 - normalized) % 360
  const slice = 360 / count
  return Math.floor(pointerAngle / slice)
}

/**
 * SVG label angle for a slice. SVG rotate(0) points to 3 o'clock, while slices start at
 * 12 o'clock, so labels must be rotated back by 90 degrees to sit inside their own slice.
 */
export function sliceLabelAngle(index: number, count: number): number {
  const slice = 360 / count
  return index * slice + slice / 2 - 90
}
