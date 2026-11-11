// Generates the PWA / Apple Touch icons into public/ with no external deps.
// Run: node scripts/generate-icons.mjs
// Icons are full-bleed and opaque: iOS applies its own rounded-corner mask,
// and transparent pixels would render black on the home screen.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const outDir = fileURLToPath(new URL('../public/', import.meta.url))

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const SEGMENTS = ['#d1d5db', '#93c5fd', '#cbd5e1', '#bfdbfe', '#e2e8f0', '#60a5fa', '#e5e7eb', '#3b82f6'].map(hex)
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

// Colour of a single sample point in unit space (0..1), `maskable` shrinks
// the artwork into the 80% safe zone used by Android/Chrome maskable icons.
function sample(u, v, scale) {
  // Brushed-silver background: vertical gradient + faint horizontal brushing
  const brush = Math.sin(v * 900) * 2 + Math.sin(v * 2300 + u * 3) * 1.5
  let c = mix(hex('#f7f7fa'), hex('#d4d4dc'), v).map((x) => x + brush)

  const x = (u - 0.5) / scale
  const y = (v - 0.53) / scale
  const r = Math.hypot(x, y)
  const R = 0.36

  // Soft drop shadow under the wheel
  const sr = Math.hypot(x, y - 0.025)
  if (sr < R + 0.06) c = mix(c, [0, 0, 0], 0.18 * Math.max(0, 1 - (sr - R + 0.02) / 0.08))

  if (r < R + 0.035) {
    if (r > R + 0.022) c = hex('#b8b8c0') // outer silver ring
    else if (r > R) c = hex('#222226') // dark bezel
    else {
      let ang = (Math.atan2(x, -y) * 180) / Math.PI // 0deg = top, clockwise
      if (ang < 0) ang += 360
      const seg = Math.floor(ang / 45)
      c = SEGMENTS[seg]
      // thin divider lines
      const edge = Math.abs(((ang + 22.5) % 45) - 22.5)
      if (edge * (Math.PI / 180) * r < 0.004) c = hex('#ffffff')
      // chrome hub
      if (r < 0.095) {
        c = r > 0.08 ? hex('#787880') : mix(hex('#ffffff'), hex('#c0c0c8'), Math.hypot(x + 0.02, y + 0.03) / 0.1)
      }
    }
  }

  // Pointer triangle at the top of the wheel
  const py = (v - 0.53) / scale + R + 0.02 // 0 at pointer tip region
  const top = -0.1
  if (py > top && py < 0.03) {
    const halfW = ((0.03 - py) / (0.03 - top)) * 0.07
    if (Math.abs(x) < halfW) c = hex('#1c1c1e')
  }
  return c
}

function render(size, scale) {
  const SS = 4 // supersampling for smooth anti-aliased edges
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0]
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const s = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, scale)
          acc = acc.map((a, i) => a + s[i])
        }
      const o = py * (size * 3 + 1) + 1 + px * 3
      for (let i = 0; i < 3; i++) raw[o + i] = Math.max(0, Math.min(255, Math.round(acc[i] / (SS * SS))))
    }
  }
  return png(size, raw)
}

function png(size, raw) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const targets = [
  ['apple-touch-icon.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.8],
]
for (const [name, size, scale] of targets) {
  writeFileSync(outDir + name, render(size, scale))
  console.log('wrote public/' + name)
}
