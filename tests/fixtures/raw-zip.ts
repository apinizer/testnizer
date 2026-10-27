/**
 * A tiny zip WRITER for tests (issue #276 follow-up), built here so tests can
 * craft archives no archiving library would write: `../` and absolute names,
 * backslashes, symbolic-link mode bits, the encryption flag, declared sizes
 * that lie. Stored (0) or deflated (8) entries, one central directory, no
 * zip64. The CRC-32 table is hand-rolled: `zlib.crc32` needs Node ≥ 22 and CI
 * runs Node 20.
 */
import zlib from 'node:zlib'

export interface RawZipEntry {
  name: string
  data?: Buffer | string
  /** 0 = stored (default for directories), 8 = deflated (default). */
  method?: 0 | 8
  /** General-purpose flags (bit 0 = encrypted). Bit 11 (UTF-8 names) is always set. */
  flags?: number
  /** External file attributes (unix mode in the high 16 bits). */
  externalAttr?: number
  /** Overrides the uncompressed size written in the headers. */
  declaredSize?: number
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Unix mode bits → external attributes. */
export const unixMode = (mode: number): number => (mode << 16) >>> 0

export function rawZip(entries: RawZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8')
    const method = e.method ?? (e.name.endsWith('/') ? 0 : 8)
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw
    const crc = crc32(raw)
    const size = e.declaredSize ?? raw.length
    const flags = (e.flags ?? 0) | 0x800
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4) // made by unix, spec 3.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(
      e.externalAttr ?? unixMode(e.name.endsWith('/') ? 0o040755 : 0o100644),
      38,
    )
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, cd, eocd])
}
