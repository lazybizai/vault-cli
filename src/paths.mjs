/**
 * Where a skill lands, and how it becomes visible to the agents.
 *
 * `<root>/.agents/skills/<id>/` is the real directory; `~/.claude/skills/<id>`
 * is a symlink pointing at it. That split is the workspace's own layout, not an
 * invention here: one copy on disk, read by every agent that looks for skills.
 *
 * The symlink target is RELATIVE. An absolute $HOME path written on one machine
 * is a dead link on another, and these directories get synced between machines.
 */
import { homedir } from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

export const MARKER = '.vault-version'

/** The directory skills are installed into. */
export function skillsRoot({ dir } = {}) {
  if (dir) return path.resolve(dir)
  if (process.env.VAULT_SKILLS_DIR) return path.resolve(process.env.VAULT_SKILLS_DIR)
  return path.join(homedir(), '.agents', 'skills')
}

/**
 * The Claude-side alias directory, or null when this machine has no ~/.claude.
 * Only the default (global) root is aliased: a skill installed into an explicit
 * --dir belongs to that tree and linking it into the home directory would make
 * a throwaway install look permanent.
 */
export function aliasRoot({ dir } = {}) {
  if (dir || process.env.VAULT_SKILLS_DIR) return null
  const claude = path.join(homedir(), '.claude')
  if (!fs.existsSync(claude)) return null
  return path.join(claude, 'skills')
}

/** Read the install marker, or null when the skill is not a vault install. */
export function readMarker(root, id) {
  try {
    const raw = fs.readFileSync(path.join(root, id, MARKER), 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed?.version === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** Every vault-installed skill under `root`, as {id, version, …}. */
export function listInstalled(root) {
  let names = []
  try {
    names = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name)
  } catch {
    return []
  }
  const out = []
  for (const id of names.sort()) {
    const marker = readMarker(root, id)
    if (marker) out.push({ id, ...marker })
  }
  return out
}

/**
 * Point `<aliasRoot>/<id>` at the installed skill.
 * Returns 'linked' | 'kept' | 'skipped'. An existing real directory is never
 * touched: it holds content this CLI did not write.
 */
export function linkAlias(alias, root, id) {
  if (!alias) return 'skipped'
  fs.mkdirSync(alias, { recursive: true })
  const link = path.join(alias, id)
  const target = path.relative(alias, path.join(root, id))

  let current = null
  try {
    current = fs.readlinkSync(link)
  } catch {
    if (fs.existsSync(link)) return 'skipped'
  }
  if (current === target) return 'kept'
  if (current !== null) fs.rmSync(link)
  fs.symlinkSync(target, link)
  return 'linked'
}
