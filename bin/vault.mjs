#!/usr/bin/env node
/**
 * lazybiz — install and update Lazy Biz vault skills.
 *
 *   npx lazybiz login
 *   npx lazybiz add <skill-id>
 *   npx lazybiz update
 *   npx lazybiz list
 *   npx lazybiz logout
 *
 * Published on npm as `lazybiz`; `npx github:lazybizai/vault-cli` still works
 * for anyone who copied the old command.
 *
 * No dependencies on purpose: npx installs the package before our first line
 * runs, so every dependency is time the member waits and code we did not
 * write. Node 18 ships everything this needs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_BASE_URL,
  VaultError,
  downloadZip,
  fetchCatalog,
  resolveBaseUrl,
  resolveKey,
} from '../src/api.mjs'
import { installSkill, InstallError } from '../src/install.mjs'
import { accessToken, configDir, login, logout } from '../src/auth.mjs'
import { MARKER, aliasRoot, linkAlias, listInstalled, readMarker, skillsRoot } from '../src/paths.mjs'

const pkg = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
)

const HELP = `lazybiz ${pkg.version} — install Lazy Biz vault skills

Usage
  npx lazybiz login                 sign in with your Whop account (once per machine)
  npx lazybiz add <skill-id>        install or reinstall one skill
  npx lazybiz update [skill-id]     reinstall every installed skill whose version changed
  npx lazybiz list                  show what is installed and what is available
  npx lazybiz logout                forget the login on this machine
  npx lazybiz --help                this text
  npx lazybiz --version             print the CLI version

Options
  --no-browser       login: print a link to open anywhere, then paste the code
                     the page shows. Used automatically when there is no display.
  --key <KEY>        the older install key from Skills Vault, instead of login.
                     Falls back to $VAULT_KEY.
  --base-url <URL>   the vault to talk to. Default ${DEFAULT_BASE_URL}
                     (or $VAULT_BASE_URL).
  --global           install into ~/.agents/skills. This is the default.
  --dir <PATH>       install into <PATH> instead of ~/.agents/skills.
                     Falls back to $VAULT_SKILLS_DIR.
  --force            overwrite a skill directory this CLI did not install.

Where things land
  ~/.agents/skills/<skill-id>/            the skill itself, plus a ${MARKER} marker
  ~/.claude/skills/<skill-id>             a symlink to it, when ~/.claude exists

Your login is kept in ${configDir()}/auth.json and renews itself.
It is a secret, like the install key: anyone holding it can download the vault.
`

/** Parse argv into {command, positionals, flags}. Unknown flags are an error. */
function parseArgs(argv) {
  const known = {
    '--key': 'key',
    '--base-url': 'baseUrl',
    '--dir': 'dir',
  }
  const booleans = { '--no-browser': 'noBrowser', '--global': 'global', '--force': 'force', '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version' }
  const flags = {}
  const positionals = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg in booleans) {
      flags[booleans[arg]] = true
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq > 0 ? arg.slice(0, eq) : arg
    if (name in known) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i]
      if (value === undefined) throw new VaultError(`${name} needs a value`)
      flags[known[name]] = value
      continue
    }
    if (arg.startsWith('-')) throw new VaultError(`unknown option ${arg} (try --help)`)
    positionals.push(arg)
  }
  return { command: positionals[0], positionals: positionals.slice(1), flags }
}

/** The credential for downloads: an explicit key wins, then the saved login. */
async function requireCred(flags) {
  const key = resolveKey(flags.key)
  if (key) return { key }
  const token = await accessToken()
  if (token) return { token }
  throw new VaultError(
    'you are not signed in.\n' +
      '  Run: npx lazybiz login   (signs in with your Whop account)\n' +
      '  Or pass --key <KEY> from the skill page in Whop.',
  )
}

function findInCatalog(catalog, id) {
  const hit = catalog.find((s) => s.id === id)
  if (!hit) {
    const names = catalog.map((s) => s.id)
    const near = names.filter((n) => n.includes(id) || id.includes(n)).slice(0, 3)
    throw new VaultError(
      `the vault has no skill called "${id}".` +
        (near.length ? `\n  Did you mean: ${near.join(', ')}?` : '') +
        `\n  Run "vault list" to see all ${names.length}.`,
    )
  }
  return hit
}

/** Download, unpack and alias one skill. Returns a printable summary. */
async function installOne({ entry, cred, baseUrl, root, alias, force }) {
  const zip = await downloadZip(baseUrl, entry.id, cred)
  const { files, replaced } = installSkill({
    root,
    id: entry.id,
    zip,
    version: entry.version,
    baseUrl,
    force,
  })
  const linked = linkAlias(alias, root, entry.id)
  return { files, replaced, linked }
}

async function cmdAdd(positionals, flags) {
  const id = positionals[0]
  if (!id) throw new VaultError('which skill? Usage: npx lazybiz add <skill-id>')

  const baseUrl = resolveBaseUrl(flags.baseUrl)
  const cred = await requireCred(flags)
  const root = skillsRoot(flags)
  const alias = aliasRoot(flags)

  const entry = findInCatalog(await fetchCatalog(baseUrl), id)
  if (!entry.available) {
    throw new VaultError(`"${id}" is announced but has no file yet. Nothing to install.`)
  }

  const summary = await installOne({ entry, cred, baseUrl, root, alias, force: flags.force })
  console.log(
    `${summary.replaced ? 'Reinstalled' : 'Installed'} ${entry.id} v${entry.version} ` +
      `(${summary.files} files) in ${path.join(root, entry.id)}`,
  )
  if (summary.linked === 'linked') {
    console.log(`Linked ${path.join(alias, entry.id)} -> the install above`)
  } else if (summary.linked === 'skipped' && alias) {
    console.log(`Left ${path.join(alias, entry.id)} alone (something real is already there)`)
  }
  console.log(`\nTell your agent to use it: "use the ${entry.id} skill".`)
}

async function cmdUpdate(positionals, flags) {
  const baseUrl = resolveBaseUrl(flags.baseUrl)
  const cred = await requireCred(flags)
  const root = skillsRoot(flags)
  const alias = aliasRoot(flags)

  const only = positionals[0]
  const installed = listInstalled(root).filter((s) => !only || s.id === only)

  if (installed.length === 0) {
    if (only) {
      throw new VaultError(
        `"${only}" is not installed in ${root} (no ${MARKER}).\n` +
          `  Install it first: npx lazybiz add ${only}`,
      )
    }
    console.log(`Nothing installed in ${root} yet. Start with: npx lazybiz add <skill-id>`)
    return
  }

  const catalog = await fetchCatalog(baseUrl)
  const stale = []
  const gone = []
  for (const local of installed) {
    const remote = catalog.find((s) => s.id === local.id)
    if (!remote) {
      gone.push(local)
    } else if (remote.available && remote.version !== local.version) {
      stale.push({ local, remote })
    }
  }

  if (stale.length === 0) {
    console.log(`Up to date — ${installed.length} skill(s) match the vault.`)
  }
  for (const { local, remote } of stale) {
    const summary = await installOne({ entry: remote, cred, baseUrl, root, alias, force: true })
    console.log(`Updated ${remote.id} ${local.version} -> ${remote.version} (${summary.files} files)`)
  }
  for (const local of gone) {
    console.log(`Note: ${local.id} is installed but no longer in the vault. Left untouched.`)
  }
}

async function cmdList(_positionals, flags) {
  const baseUrl = resolveBaseUrl(flags.baseUrl)
  const root = skillsRoot(flags)
  const installed = new Map(listInstalled(root).map((s) => [s.id, s]))

  // The catalog route needs no key — a version comparison should not have to
  // pass the download gate. --key is accepted so one habit fits every command.
  const catalog = await fetchCatalog(baseUrl)

  console.log(`${baseUrl}  ->  ${root}\n`)
  const ids = [...catalog.map((s) => s.id), ...installed.keys()]
  const width = Math.max(4, ...ids.map((id) => id.length))
  for (const s of catalog) {
    const local = installed.get(s.id)
    let state
    if (!s.available) state = 'coming soon'
    else if (!local) state = 'available'
    else if (local.version === s.version) state = `installed v${local.version}`
    else state = `update: v${local.version} -> v${s.version}`
    console.log(`  ${s.id.padEnd(width)}  ${state.padEnd(24)} ${s.oneLiner ?? ''}`)
    installed.delete(s.id)
  }
  for (const [id, local] of installed) {
    console.log(`  ${id.padEnd(width)}  ${`v${local.version}, not in vault`.padEnd(24)}`)
  }
  console.log(`\n${catalog.length} skill(s) in the vault.`)
}

async function cmdLogin(_positionals, flags) {
  await login({ browser: flags.noBrowser ? false : undefined })
  console.log(`\nSigned in. Your login is saved in ${configDir()} and renews itself.`)
  console.log('Next: npx lazybiz list')
}

async function cmdLogout() {
  const was = await logout()
  console.log(was ? 'Signed out on this machine.' : 'You were not signed in on this machine.')
}

async function main() {
  let parsed
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`lazybiz: ${e.message}`)
    process.exit(2)
  }
  const { command, positionals, flags } = parsed

  if (flags.version) {
    console.log(pkg.version)
    return
  }
  if (flags.help || !command || command === 'help') {
    console.log(HELP)
    return
  }

  const commands = { add: cmdAdd, update: cmdUpdate, list: cmdList, login: cmdLogin, logout: cmdLogout }
  const run = commands[command]
  if (!run) {
    console.error(`lazybiz: unknown command "${command}". Try: login, add, update, list, logout, --help`)
    process.exit(2)
  }

  try {
    await run(positionals, flags)
  } catch (e) {
    if (e instanceof VaultError || e instanceof InstallError) {
      console.error(`lazybiz: ${e.message}`)
      process.exit(1)
    }
    throw e
  }
}

main().catch((e) => {
  console.error(`lazybiz: unexpected failure — ${e?.stack ?? e}`)
  process.exit(1)
})
