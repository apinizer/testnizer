#!/usr/bin/env node
/**
 * Icon generation script.
 *
 * Takes the Testnizer "A" mark from the logo PNG, places it on a white
 * rounded-square background with 20% padding, and generates all platform icons.
 *
 * Outputs:
 *   - build/icons/icon-<size>.png         standard sizes
 *   - build/icons/icon-<size>@2x.png      macOS retina variants
 *   - build/icon.png                      512x512 (Linux + electron-builder)
 *   - build/icon.ico                      multi-size Windows ICO
 *   - build/icon.icns                     macOS ICNS
 *   - resources/icon.png                  runtime PNG
 *   - resources/icon.ico                  runtime ICO
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import png2icons from 'png2icons'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BUILD_DIR = resolve(ROOT, 'build')
const ICONS_DIR = resolve(BUILD_DIR, 'icons')
const RESOURCES_DIR = resolve(ROOT, 'resources')

// Source: extract the "A" mark from the full Testnizer logo
const LOGO_PATH = '/Users/ertugrulaslan/temp/apinizer-logo.png'

const STANDARD_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

/**
 * Create a rounded-square background SVG at a given size.
 *
 * macOS standard: the visible icon occupies ~80% of the canvas, leaving
 * ~10% transparent margin on each side. The dock reads this transparent
 * area and sizes the icon accordingly so it matches other apps.
 *
 * Corner radius is ~22.37% of the *visible* square (Apple HIG: 230/1024).
 */
function roundedSquareBgSvg(size) {
  const margin = Math.round(size * 0.10)          // 10% transparent margin each side
  const s = size - margin * 2                     // visible square is 80% of canvas
  const r = Math.round(s * 0.2237)
  const sw = Math.max(0.5, Math.round(size * 0.003))
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect x="${margin}" y="${margin}" width="${s}" height="${s}" rx="${r}" ry="${r}" fill="#F5F5F7"/>
      <rect x="${margin}" y="${margin}" width="${s}" height="${s}" rx="${r}" ry="${r}" fill="none" stroke="#DCDCE0" stroke-width="${sw}"/>
    </svg>`
  )
}

async function main() {
  if (!existsSync(LOGO_PATH)) {
    console.error(`Logo source not found: ${LOGO_PATH}`)
    process.exit(1)
  }
  if (!existsSync(ICONS_DIR)) mkdirSync(ICONS_DIR, { recursive: true })

  console.log('Extracting Testnizer "A" mark from logo...\n')

  // Extract the "A" mark (left ~110x110 of the 500x110 logo)
  const markBuffer = await sharp(LOGO_PATH)
    .extract({ left: 0, top: 0, width: 110, height: 110 })
    .png()
    .toBuffer()

  // Also save the extracted mark as the SVG source reference
  writeFileSync(resolve(BUILD_DIR, 'mark-source.png'), markBuffer)
  console.log('  ✓ Extracted 110x110 mark → build/mark-source.png\n')

  console.log('Generating icons with white rounded background + 20% padding...\n')

  const pngBuffers = {}

  for (const size of STANDARD_SIZES) {
    // 1. Create rounded-square background
    const bg = await sharp(roundedSquareBgSvg(size))
      .resize(size, size)
      .png()
      .toBuffer()

    // 2. Resize the mark: 10% canvas margin + 12% inner padding = logo at ~56% of canvas
    const padding = Math.round(size * 0.22)  // total from edge to logo
    const innerSize = size - padding * 2
    const resizedMark = await sharp(markBuffer)
      .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()

    // 3. Composite mark onto white background, centered
    const result = await sharp(bg)
      .composite([{
        input: resizedMark,
        left: padding,
        top: padding,
      }])
      .png({ compressionLevel: 9 })
      .toBuffer()

    const out = resolve(ICONS_DIR, `icon-${size}.png`)
    writeFileSync(out, result)
    pngBuffers[size] = result
    console.log(`  ✓ ${String(size).padStart(4)}x${size}     →  build/icons/icon-${size}.png`)
  }

  // macOS @2x retina variants
  const retinaPairs = [
    { name: 16, pixels: 32 },
    { name: 32, pixels: 64 },
    { name: 128, pixels: 256 },
    { name: 256, pixels: 512 },
    { name: 512, pixels: 1024 },
  ]
  for (const pair of retinaPairs) {
    const buf = pngBuffers[pair.pixels]
    const fname = `icon-${pair.name}@2x.png`
    writeFileSync(resolve(ICONS_DIR, fname), buf)
    console.log(`  ✓ ${String(pair.pixels).padStart(4)}x${pair.pixels}     →  build/icons/${fname}  (${pair.name}@2x)`)
  }

  // Main PNGs
  writeFileSync(resolve(BUILD_DIR, 'icon.png'), pngBuffers[512])
  writeFileSync(resolve(RESOURCES_DIR, 'icon.png'), pngBuffers[512])
  console.log('  ✓  512x512   →  build/icon.png')
  console.log('  ✓  512x512   →  resources/icon.png')

  // Windows .ico
  const icoSource = pngBuffers[1024]
  const icoBuf = png2icons.createICO(icoSource, png2icons.BILINEAR, 0, false)
  if (!icoBuf) throw new Error('Failed to generate .ico')
  writeFileSync(resolve(BUILD_DIR, 'icon.ico'), icoBuf)
  writeFileSync(resolve(RESOURCES_DIR, 'icon.ico'), icoBuf)
  console.log('  ✓  multi     →  build/icon.ico')
  console.log('  ✓  multi     →  resources/icon.ico')

  // macOS .icns
  const icnsBuf = png2icons.createICNS(icoSource, png2icons.BILINEAR, 0)
  if (!icnsBuf) throw new Error('Failed to generate .icns')
  writeFileSync(resolve(BUILD_DIR, 'icon.icns'), icnsBuf)
  console.log('  ✓  multi     →  build/icon.icns')

  // Update dev Electron .app
  const devIcns = resolve(ROOT, 'node_modules/electron/dist/Testnizer.app/Contents/Resources/electron.icns')
  if (existsSync(dirname(devIcns))) {
    writeFileSync(devIcns, icnsBuf)
    writeFileSync(resolve(dirname(devIcns), 'icon.png'), pngBuffers[512])
    console.log('  ✓  multi     →  Testnizer.app/electron.icns (dev)')
  }

  console.log('\nDone — all icons generated from Testnizer logo.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
