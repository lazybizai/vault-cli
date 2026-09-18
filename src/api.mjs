/**
 * The vault's HTTP surface. Two routes, and the base URL is a parameter so the
 * same CLI serves a future vault without a code change.
 *
 * DEFAULT HOST IS `.whop.site`, NEVER `.whop.app`. whop.app answers 307 and the
 * client follows that redirect OUTSIDE Whop's proxy, which drops the auth header
 * — a download then returns a 401 JSON body that looks exactly like a zip until
 * you open it. Every request this CLI makes rides on this one value.
 */
export const DEFAULT_BASE_URL = 'https://lazybiz-skills.whop.site'

export class VaultError extends Error {}

export function resolveBaseUrl(flag) {
  const raw = flag || process.env.VAULT_BASE_URL || DEFAULT_BASE_URL
  const url = raw.replace(/\/+$/, '')
  if (!/^https?:\/\//.test(url)) {
    throw new VaultError(`base URL must start with http:// or https:// — got "${raw}"`)
  }
  return url
}

export function resolveKey(flag) {
  const key = (flag || process.env.VAULT_KEY || '').trim()
  return key || null
}

async function getJson(url, what) {
  let res
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } })
  } catch (e) {
    throw new VaultError(`could not reach ${new URL(url).origin} — ${e.message}`)
  }
  if (!res.ok) {
    throw new VaultError(`${what} failed: HTTP ${res.status} from ${url}`)
  }
  let body
  try {
    body = await res.json()
  } catch {
    throw new VaultError(`${what} returned something that is not JSON — is the base URL right?`)
  }
  if (body?.ok === false) {
    throw new VaultError(`${what} failed: ${body.error ?? 'unknown error'}`)
  }
  return body
}

/**
 * The catalog. Ungated on purpose — it carries ids, names and versions only, so
 * a version comparison never needs the key. The bytes still do.
 */
export async function fetchCatalog(baseUrl) {
  const body = await getJson(`${baseUrl}/api/skills`, 'catalog lookup')
  if (!Array.isArray(body?.skills)) {
    throw new VaultError(`catalog lookup returned no skills list — is ${baseUrl} the vault?`)
  }
  return body.skills
}

/**
 * Download one skill's zip. The key is a bearer secret and goes in the query
 * string because that is what the route accepts; it is never logged.
 */
export async function downloadZip(baseUrl, id, key) {
  const url = `${baseUrl}/api/install/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}`
  let res
  try {
    res = await fetch(url)
  } catch (e) {
    throw new VaultError(`could not reach ${baseUrl} — ${e.message}`)
  }

  if (res.status === 401 || res.status === 403) {
    throw new VaultError(
      'the vault rejected your install key.\n' +
        '  Open the skill in Whop and copy the command again — it carries a fresh key.\n' +
        '  Nothing was installed.',
    )
  }
  if (res.status === 404) {
    throw new VaultError(
      `the vault has no downloadable file for "${id}" yet (it may be marked as coming soon).`,
    )
  }
  if (!res.ok) {
    throw new VaultError(`download failed: HTTP ${res.status} for ${id}`)
  }

  // A JSON body here means an error page slipped through with a 200, which is
  // what a redirect off the proxy looks like. Treat it as a failure, not a zip.
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    throw new VaultError(
      `the vault returned JSON instead of a zip for "${id}".\n` +
        `  Check that the base URL is the .whop.site host, not .whop.app.`,
    )
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 22 || buf.readUInt16LE(0) !== 0x4b50) {
    throw new VaultError(`the download for "${id}" is not a zip file (${buf.length} bytes).`)
  }
  return buf
}
