#!/usr/bin/env node
/**
 * Icon generation script.
 *
 * Reads `build/icon.svg` and produces:
 *   - build/icons/icon-<size>.png for each size below
 *   - build/icon.png          (512x512 main PNG, used by Linux + electron-builder default)
 *   - resources/icon.png      (512x512 PNG, used at runtime by the main process)
 *   - build/icon.ico          (multi-size Windows ICO)
 *   - build/icon.icns          (macOS ICNS)
 *   - resources/icon.ico      (copy for runtime reference)
 *
 * Uses `sharp` for SVG → PNG rasterisation and `png2icons` for ICO/ICNS
 * (cross-platform — does not rely on macOS iconutil).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import png2icons from 'png2icons'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SVG_PATH = resolve(ROOT, 'build/icon.svg')
const BUILD_DIR = resolve(ROOT, 'build')
const ICONS_DIR = resolve(BUILD_DIR, 'icons')
const RESOURCES_DIR = resolve(ROOT, 'resources')

const SIZES = [16, 32, 48, 64, 128, 256, 512]

async function main() {
  if (!existsSync(SVG_PATH)) {
    console.error(`SVG source not found: ${SVG_PATH}`)
    process.exit(1)
  }
  if (!existsSync(ICONS_DIR)) mkdirSync(ICONS_DIR, { recursive: true })

  const svg = readFileSync(SVG_PATH)

  // ── 1. Rasterise SVG to each PNG size ──────────────────────
  const pngBuffers = {}
  for (const size of SIZES) {
    const buf = await sharp(svg)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
    const out = resolve(ICONS_DIR, `icon-${size}.png`)
    writeFileSync(out, buf)
    pngBuffers[size] = buf
    console.log(`  ✓ ${size.toString().padStart(3)}x${size}  →  build/icons/icon-${size}.png`)
  }

  // ── 2. Main PNGs used by electron-builder + runtime ────────
  writeFileSync(resolve(BUILD_DIR, 'icon.png'), pngBuffers[512])
  writeFileSync(resolve(RESOURCES_DIR, 'icon.png'), pngBuffers[512])
  console.log('  ✓ 512x512  →  build/icon.png')
  console.log('  ✓ 512x512  →  resources/icon.png')

  // ── 3. Windows .ico (multi-size: png2icons packs multiple sizes) ──
  // png2icons takes ONE source PNG and produces ico/icns with multiple
  // internal sizes. Feed it the 512 PNG for best quality at all sizes.
  const icoBuf = png2icons.createICO(pngBuffers[512], png2icons.BILINEAR, 0, false)
  if (!icoBuf) throw new Error('Failed to generate .ico')
  writeFileSync(resolve(BUILD_DIR, 'icon.ico'), icoBuf)
  writeFileSync(resolve(RESOURCES_DIR, 'icon.ico'), icoBuf)
  console.log('  ✓ multi   →  build/icon.ico')
  console.log('  ✓ multi   →  resources/icon.ico')

  // ── 4. macOS .icns ─────────────────────────────────────────
  const icnsBuf = png2icons.createICNS(pngBuffers[512], png2icons.BILINEAR, 0)
  if (!icnsBuf) throw new Error('Failed to generate .icns')
  writeFileSync(resolve(BUILD_DIR, 'icon.icns'), icnsBuf)
  console.log('  ✓ multi   →  build/icon.icns')

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
