# lazybiz

Install Lazy Biz vault skills into your own machine with one command.

A skill is a folder your coding agent reads: instructions, reference notes and
sometimes scripts. This CLI downloads the ones you have access to, puts them
where your agent looks for them, and keeps them current.

Requires **Node 18 or newer**. Nothing else — no install, no account, no
dependencies.

## Install a skill

Open the skill in Whop and copy the command. It already carries your personal
install key:

```bash
npx lazybiz add brand-kit --key YOUR_KEY
```

That puts the skill in `~/.agents/skills/brand-kit/` and, if you have a
`~/.claude` directory, links it into `~/.claude/skills/` so Claude Code picks it
up. Then tell your agent: *"use the brand-kit skill"*.

`npx github:lazybizai/vault-cli add …` also works — it is the same code from
the public mirror, and the older command in your notes keeps running.

## Keep them current

```bash
npx lazybiz update --key YOUR_KEY
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
| `--key <KEY>` | Your install key. Also read from `$VAULT_KEY`. |
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

## Your install key is a secret

Anyone holding the key can download the vault from any terminal. Treat it like a
password: do not paste it into a shared channel or commit it. If it leaks, ask
for a new one — the old one stops working.

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

**"the vault rejected your install key"** — the key is wrong, or it was
replaced. Open the skill in Whop and copy the command again.

**"returned JSON instead of a zip"** — you are pointed at a host that redirects
away from Whop's proxy. Use the `.whop.site` address, not `.whop.app`.

**"already exists and was not installed by this CLI"** — you have your own
folder by that name. Move it aside, or use `--force` if you want the vault's
version to win.

**An old version keeps running** — npx caches what it downloaded. Ask for the
newest one with `npx lazybiz@latest add …`.
