/**
 * Unpack one skill zip into the skills root.
 *
 * Two rules do the real work here:
 *
 * 1. **A directory without our marker is never overwritten.** The skills root
 *    is where hand-written skills live too, and on a maintainer's machine it is
 *    a symlink into the repository those skills come FROM. An `add` that
 *    silently replaced `writing/` there would delete the source, not a copy.
 *    Refuse, name the file, and let --force be a decision the member makes.
 * 2. **Extract to a temporary directory first, then swap.** A download that
 *    fails halfway must leave the previous install intact.
 */
import fs from 'node:fs'
import path from 'node:path'
import { listEntries, readEntry } from './unzip.mjs'
import { MARKER, readMarker } from './paths.mjs'

export class InstallError extends Error {}

/** Reject anything that would write outside the target directory. */
function safeName(name) {
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.includes('\\')) return null
  const parts = name.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.some((p) => p === '..')) return null
  return parts.join('/')
}

/**
 * Extract the zip into `dest`.
 *
 * The pipeline's packages are `<id>/…` PLUS a loose `VAULT-INFO.md` at the zip
 * root — the wrapper is not the only thing up there. So the rule is per entry,
 * not per archive: strip the `<id>/` prefix where it appears, keep root-level
 * files as they are. The member ends up with the skill's own files at the top of
 * `<id>/` and the provenance note beside them, which is the layout the skill
 * pages describe. A flat zip with no wrapper lands as-is under the same rule.
 *
 * (Found the hard way: assuming every entry carried the prefix produced
 * `<id>/<id>/SKILL.md`, and an agent looking for `<id>/SKILL.md` found nothing.)
 */
function extractInto(zip, dest, id) {
  const entries = listEntries(zip)
  const files = entries.filter((e) => !e.isDir)
  if (files.length === 0) throw new InstallError('the package is empty')

  const prefix = `${id}/`

  let written = 0
  for (const entry of files) {
    const stripped = entry.name.startsWith(prefix) ? entry.name.slice(prefix.length) : entry.name
    const rel = safeName(stripped)
    if (!rel) throw new InstallError(`the package contains an unsafe path: ${entry.name}`)

    const target = path.join(dest, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, readEntry(zip, entry))
    // Keep the executable bit; skills ship scripts that are meant to run.
    if (entry.mode & 0o111) fs.chmodSync(target, 0o755)
    written++
  }
  return written
}

/**
 * Install `id` from `zip` under `root`.
 * @returns {{files: number, replaced: boolean}}
 */
export function installSkill({ root, id, zip, version, baseUrl, force = false }) {
  const finalDir = path.join(root, id)
  // lstat, not existsSync: a dangling symlink is in the way too.
  const existing = fs.lstatSync(finalDir, { throwIfNoEntry: false }) != null

  if (existing && !readMarker(root, id) && !force) {
    throw new InstallError(
      `${finalDir} already exists and was not installed by this CLI (no ${MARKER}).\n` +
        `  Refusing to overwrite it. Move it aside, or rerun with --force.`,
    )
  }

  fs.mkdirSync(root, { recursive: true })
  const staging = path.join(root, `.${id}.vault-tmp`)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })

  let files
  try {
    files = extractInto(zip, staging, id)
    fs.writeFileSync(
      path.join(staging, MARKER),
      `${JSON.stringify({ id, version, source: baseUrl, installedAt: new Date().toISOString() }, null, 2)}\n`,
    )
    // Swap last: until this point the previous install is still the live one.
    fs.rmSync(finalDir, { recursive: true, force: true })
    fs.renameSync(staging, finalDir)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }

  return { files, replaced: existing }
}
