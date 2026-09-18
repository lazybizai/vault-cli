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
