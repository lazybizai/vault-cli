# lazybiz

Install Lazy Biz vault skills into your own machine with one command.

A skill is a folder your coding agent reads: instructions, reference notes and
sometimes scripts. This CLI downloads the ones you have access to, puts them
where your agent looks for them, and keeps them current.

Requires **Node 18 or newer** and a Lazy Biz membership on Whop. Nothing
else — no install, no dependencies.

## Sign in once

```bash
npx lazybiz login
```

Your browser opens, you sign in with your Whop account, and you are done. The
login is saved on this machine and renews itself; you do not need to do this
again. On a machine without a browser (SSH, a server) the CLI prints a link
instead: open it on any device, sign in, and paste the code the page shows back
into the terminal. `--no-browser` forces that path.

`npx lazybiz logout` forgets the login on this machine.

## Install a skill

```bash
npx lazybiz add brand-kit
```

That puts the skill in `~/.agents/skills/brand-kit/` and, if you have a
`~/.claude` directory, links it into `~/.claude/skills/` so Claude Code picks it
up. Then tell your agent: *"use the brand-kit skill"*.

`npx github:lazybizai/vault-cli add …` also works — it is the same code from
the public mirror, and the older command in your notes keeps running.

## Keep them current

```bash
npx lazybiz update
```

Compares every installed skill against the vault and reinstalls only the ones
whose version moved. Add a skill id to update just that one.

## See what is available

```bash
npx lazybiz list
```

Shows the whole catalog with each skill's state: installed, update available,
or coming soon. The catalog needs no key.

## Options

| Option | What it does |
|---|---|
| `--no-browser` | `login`: print a link and read back a code instead of opening a browser. |
| `--key <KEY>` | The older install key from Skills Vault, instead of `login`. Also read from `$VAULT_KEY`. |
| `--base-url <URL>` | Which vault to talk to. Default `https://lazybiz-skills.whop.site`, also read from `$VAULT_BASE_URL`. |
| `--global` | Install into `~/.agents/skills`. This is the default. |
| `--dir <PATH>` | Install somewhere else instead. Also read from `$VAULT_SKILLS_DIR`. |
| `--force` | Overwrite a skill directory this CLI did not install. |

## Where files land

```
~/.agents/skills/<skill-id>/            the skill, plus a .vault-version marker
~/.claude/skills/<skill-id>             a symlink to it (when ~/.claude exists)
```

One copy on disk, read by every agent that looks for skills. The
`.vault-version` marker is how `update` knows which version you have — deleting
it does not break the skill, but `update` will stop tracking it.

**A directory the CLI did not install is never overwritten.** If you already
have a hand-written `~/.agents/skills/writing/`, `add writing` stops and says so
rather than replacing it. `--force` overrides that, and deletes what was there.

## Your login is a secret

The login lives in `~/.config/lazybiz/auth.json` (`%APPDATA%\\lazybiz` on
Windows), readable only by you. Anyone holding that file — or the older install
key — can download the vault while your membership is active. Do not commit it
or paste it anywhere. `logout` revokes it. Every download checks that your
membership is still active, so a cancelled membership stops working at once.

## Releasing

Maintainers only. A release is a tag — there is no token to hold and nothing to
type into a prompt.

1. Bump `version` in `package.json`. npm refuses to republish a version that
   already exists, so this is the step that decides what gets published.
2. Commit, then run `scripts/mirror.sh`. It copies `bin/`, `src/`,
   `package.json`, `README.md` and `.github/` into `lazybizai/vault-cli`, then
   tags the mirror's `HEAD` with `v<version>` and pushes the tag — unless that
   tag already exists, in which case the version is already released and
   nothing is tagged.
3. The `publish` workflow runs on the tag, checks that the tag and
   `package.json` agree, and runs `npm publish --provenance --access public`.

The workflow authenticates with npm through **Trusted Publishing**: npm trusts
the repository `lazybizai/vault-cli` and the workflow file `publish.yml`, and
GitHub mints a short-lived OIDC credential for the run. No long-lived
credential exists, which is also why publishing from a laptop no longer works —
tag the mirror instead.

Every release carries **provenance**: npm records which commit and which
workflow built the tarball, and shows it on the package page. Check a release
with `npm view lazybiz@<version> --json` and look for `dist.attestations`.

If a tag disagrees with `package.json`, the run fails in the version guard
before anything reaches npm. Delete the tag
(`git push --delete origin v<version>`), fix the version and tag again.

## Troubleshooting

**"you are not signed in"** — run `npx lazybiz login`.

**"your login has expired"** — it was unused for two months, or you logged out
elsewhere. Run `npx lazybiz login` again.

**"the vault rejected your install key"** — the key is wrong, or it was
replaced. Use `npx lazybiz login` instead.

**"returned JSON instead of a zip"** — you are pointed at a host that redirects
away from Whop's proxy. Use the `.whop.site` address, not `.whop.app`.

**"already exists and was not installed by this CLI"** — you have your own
folder by that name. Move it aside, or use `--force` if you want the vault's
version to win.

**An old version keeps running** — npx caches what it downloaded. Ask for the
newest one with `npx lazybiz@latest add …`.
