export function computeWheelRotation(targetIndex: number, count: number, spins = 6): number {
  if (count <= 0) {
    return 0
  }

  const normalizedIndex = ((targetIndex % count) + count) % count
  const slice = 360 / count
  const center = normalizedIndex * slice + slice / 2
  return spins * 360 + (360 - center)
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
