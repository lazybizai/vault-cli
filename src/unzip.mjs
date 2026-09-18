/**
 * Minimal ZIP reader — stored + deflate, nothing else.
 *
 * The CLI runs through `npx github:…`, which installs whatever `dependencies`
 * says before the first line of our code runs. Every dependency is therefore a
 * download the member waits through and a supply chain we do not control, for a
 * job Node's own `zlib` already does. Shelling out to `unzip` was the other
 * candidate and was dropped: it is absent on a plain Windows box, and the point
 * of the npx route is that it works on the machine the member already has.
 *
 * The vault's zips come from Python's `zipfile` with ZIP_DEFLATED, so store and
 * deflate cover them. Zip64 is detected and refused rather than mis-parsed; a
 * skill package that large is a pipeline bug, not something to guess around.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CD_SIG = 0x02014b50
const LFH_SIG = 0x04034b50
const ZIP64_LOCATOR_SIG = 0x07064b50

export class ZipError extends Error {}

/** Scan backwards for the end-of-central-directory record. */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 66_000)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw new ZipError('not a zip file (no end-of-central-directory record)')
}

/**
 * List the entries in a zip.
 * @returns {{name: string, isDir: boolean, mode: number, method: number,
 *            compressedSize: number, size: number, offset: number}[]}
 */
export function listEntries(buf) {
  const eocd = findEocd(buf)

  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) {
    throw new ZipError('zip64 archives are not supported')
  }

  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || p === 0xffffffff) {
    throw new ZipError('zip64 archives are not supported')
  }

  const entries = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CD_SIG) {
      throw new ZipError(`corrupt central directory at entry ${i + 1}`)
    }
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const externalAttrs = buf.readUInt32LE(p + 38)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)

    entries.push({
      name,
      isDir: name.endsWith('/'),
      // Unix permissions live in the high 16 bits. 0 means the zip was written
      // by a tool that did not record them; the caller falls back to a default.
      mode: (externalAttrs >>> 16) & 0o7777,
      method,
      compressedSize,
      size,
      offset,
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Inflate one entry's bytes. */
export function readEntry(buf, entry) {
  if (buf.readUInt32LE(entry.offset) !== LFH_SIG) {
    throw new ZipError(`corrupt local header for ${entry.name}`)
  }
  const nameLen = buf.readUInt16LE(entry.offset + 26)
  const extraLen = buf.readUInt16LE(entry.offset + 28)
  const start = entry.offset + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compressedSize)

  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateRawSync(raw)
  throw new ZipError(`unsupported compression method ${entry.method} for ${entry.name}`)
}
