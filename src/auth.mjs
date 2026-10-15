/**
 * `lazybiz login` — sign in with the member's Whop account instead of a key.
 *
 * The login server is the Lazy Biz MCP Worker (https://mcp.lazybiz.ai), an
 * OAuth 2.1 server that hands the actual sign-in to Whop. This CLI is an
 * ordinary public client of it:
 *
 *   1. discover the endpoints (/.well-known/oauth-authorization-server)
 *   2. register itself once (dynamic client registration), cached in the config
 *   3. PKCE + a loopback redirect: open the browser, catch ?code on 127.0.0.1
 *      — or, with no browser, print the link and read back the code the login
 *      page shows (`/oauth/cli-code`)
 *   4. exchange the code; refresh before expiry; refresh tokens rotate, so
 *      every refresh is written back to disk at once
 *
 * The token file lives in the user's config dir with mode 0600. It is a
 * secret: whoever holds it can download the vault until the member logs out.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { VaultError } from './api.mjs'

export const DEFAULT_AUTH_URL = 'https://mcp.lazybiz.ai'

export function resolveAuthUrl() {
  return (process.env.LAZYBIZ_AUTH_URL || DEFAULT_AUTH_URL).replace(/\/+$/, '')
}

/** ~/.config/lazybiz (or $XDG_CONFIG_HOME, or %APPDATA% on Windows). */
export function configDir() {
  if (process.env.LAZYBIZ_CONFIG_DIR) return path.resolve(process.env.LAZYBIZ_CONFIG_DIR)
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'lazybiz')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'lazybiz')
}

const authFile = () => path.join(configDir(), 'auth.json')

export function readAuth() {
  try {
    const saved = JSON.parse(fs.readFileSync(authFile(), 'utf8'))
    return saved?.authUrl === resolveAuthUrl() ? saved : null
  } catch {
    return null
  }
}

function writeAuth(data) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const file = authFile()
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function postJson(url, body, form = false) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: form
        ? { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' }
        : { 'Content-Type': 'application/json', accept: 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    })
  } catch (e) {
    throw new VaultError(`could not reach ${new URL(url).origin} — ${e.message}`)
  }
  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, data }
}

async function discover(authUrl) {
  let res
  try {
    res = await fetch(`${authUrl}/.well-known/oauth-authorization-server`)
  } catch (e) {
    throw new VaultError(`could not reach the login server ${authUrl} — ${e.message}`)
  }
  if (!res.ok) throw new VaultError(`the login server ${authUrl} answered HTTP ${res.status}`)
  return res.json()
}

/** The page that shows the code to paste, for machines with no browser. */
const pasteRedirect = (authUrl) => `${authUrl}/oauth/cli-code`

async function registerClient(meta, authUrl) {
  const res = await postJson(meta.registration_endpoint, {
    client_name: 'Lazy Biz CLI (npx lazybiz)',
    redirect_uris: ['http://127.0.0.1/callback', pasteRedirect(authUrl)],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  })
  if (!res.ok || !res.data.client_id) {
    throw new VaultError(`could not register with the login server: ${res.data.error_description ?? res.status}`)
  }
  return res.data.client_id
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
      child.on('error', () => resolve(false))
      child.on('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

/** A desktop session we can open a browser in. Linux without a display has none (SSH, containers). */
function canOpenBrowser() {
  if (process.env.LAZYBIZ_NO_BROWSER) return false
  if (process.platform === 'linux') return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
  return true
}

/** Wait for the browser to come back to http://127.0.0.1:<port>/callback. */
function loopback() {
  return new Promise((resolve, reject) => {
    let settle
    const result = new Promise((res, rej) => (settle = { res, rej }))
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const ok = Boolean(u.searchParams.get('code'))
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        ok
          ? '<!doctype html><meta charset="utf-8"><title>Lazy Biz</title><body style="font:16px system-ui;background:#0a0708;color:#f4efe4;display:grid;place-items:center;height:100vh;margin:0"><p>Inloggad. Du kan stänga fliken och gå tillbaka till terminalen.</p>'
          : '<!doctype html><meta charset="utf-8"><p>Inloggningen avbröts. Gå tillbaka till terminalen.</p>',
      )
      server.close()
      settle.res(u.searchParams)
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, result, close: () => server.close() }))
  })
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(a.trim()))))
}

function saveTokens(base, tokens) {
  const auth = {
    ...base,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? base.refreshToken,
    expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  }
  writeAuth(auth)
  return auth
}

/**
 * Run the whole login. `browser: false` forces the paste-the-code path.
 * Returns the saved auth record.
 */
export async function login({ browser = canOpenBrowser(), print = console.log } = {}) {
  const authUrl = resolveAuthUrl()
  const meta = await discover(authUrl)
  const previous = readAuth()
  const clientId = previous?.clientId ?? (await registerClient(meta, authUrl))

  const verifier = b64url(crypto.randomBytes(32))
  const state = b64url(crypto.randomBytes(16))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())

  const local = browser ? await loopback() : null
  const redirectUri = local ? `http://127.0.0.1:${local.port}/callback` : pasteRedirect(authUrl)
  const link = `${meta.authorization_endpoint}?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${authUrl}/mcp`,
  })}`

  let code
  if (local) {
    const opened = await openBrowser(link)
    print(opened ? 'Opening your browser to sign in with Whop…' : 'Open this link to sign in with Whop:')
    print(`\n  ${link}\n`)
    print('Waiting for the browser (Ctrl+C to cancel)…')
    const params = await local.result
    if (params.get('state') !== state) throw new VaultError('the login answered for another attempt. Run login again.')
    code = params.get('code')
    if (!code) throw new VaultError(`login cancelled: ${params.get('error_description') ?? params.get('error') ?? 'no code'}`)
  } else {
    print('Open this link on any device and sign in with Whop:')
    print(`\n  ${link}\n`)
    print('The page then shows a code. Paste it here.')
    const pasted = await ask('Code: ')
    const [c, s] = pasted.split('.')
    if (!c || s !== state) throw new VaultError('that code is not from this login. Run login again.')
    code = c
  }

  const res = await postJson(
    meta.token_endpoint,
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: `${authUrl}/mcp` },
    true,
  )
  if (!res.ok || !res.data.access_token) {
    throw new VaultError(`login failed: ${res.data.error_description ?? res.data.error ?? `HTTP ${res.status}`}`)
  }
  return saveTokens({ authUrl, clientId, tokenEndpoint: meta.token_endpoint }, res.data)
}

/**
 * A valid access token, refreshed if it is about to expire. null when the
 * member never logged in. Throws when the login has expired for good.
 */
export async function accessToken({ force = false } = {}) {
  const auth = readAuth()
  if (!auth) return null
  if (!force && auth.expiresAt - Date.now() > 60_000) return auth.accessToken

  const res = await postJson(
    auth.tokenEndpoint,
    { grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: auth.clientId },
    true,
  )
  if (res.data.error === 'invalid_grant' || res.status === 401) {
    throw new VaultError('your login has expired. Run: npx lazybiz login')
  }
  if (!res.ok || !res.data.access_token) {
    throw new VaultError(`could not refresh your login: ${res.data.error_description ?? `HTTP ${res.status}`}`)
  }
  return saveTokens(auth, res.data).accessToken
}

/** Forget the login here, and revoke it at the server so the refresh token dies too. */
export async function logout() {
  const auth = readAuth()
  try {
    fs.rmSync(authFile(), { force: true })
  } catch {}
  if (!auth) return false
  // Revocation is best effort: the file is already gone, which is what logout means here.
  await postJson(auth.tokenEndpoint, { token: auth.refreshToken, token_type_hint: 'refresh_token', client_id: auth.clientId }, true).catch(() => {})
  return true
}
