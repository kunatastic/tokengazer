<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/lockup-dark.svg">
  <img alt="tokengazer" src="brand/lockup-light.svg" height="48">
</picture>

A GitHub-style contribution graph for the AI tokens you burn in Claude Code and Codex. Embed it in your README, resume or portfolio.

**[tokengazer.vercel.app](https://tokengazer.vercel.app)** · [llms.txt](https://tokengazer.vercel.app/llms.txt)

[![tokens](https://tokengazer.vercel.app/kunatastic.svg)](https://tokengazer.vercel.app/kunatastic)

```sh
npx tokengazer          # your stats, locally — nothing is uploaded
npx tokengazer login    # sign in with GitHub, publish your card, refresh hourly
```

`login` prints a snippet to paste anywhere Markdown renders:

```md
[![tokens](https://tokengazer.vercel.app/<you>.svg)](https://tokengazer.vercel.app/<you>)
```

| URL | What |
| --- | --- |
| `/<github-username>.svg` | Embeddable card (cached 1h) |
| `/<github-username>` | Profile page with per-model breakdown |
| `/<github-username>.json` | Your daily rows, for building your own view |

## What gets uploaded

Only daily totals per tool and model: `day, tool, model, input, output, cache_read, cache_write, reasoning, estimated`. Prompts, code, file paths and project names never leave your machine. GitHub sign-in asks for no scopes; the server reads your username once and discards the token.

## Where the numbers come from

- **Claude Code:** `~/.claude/projects/**/*.jsonl`. Tokens = input + output + cache reads + cache writes.
- **Codex:** `~/.codex/sessions/**/*.jsonl` (and `.jsonl.zst` on Node ≥ 22.15). Tokens = input + output (cached input and reasoning are already inside those).
- **Estimated history:** Claude Code deletes session logs after 30 days. For older days, tokengazer multiplies your prompt count (from `~/.claude/history.jsonl`) by your median tokens per prompt, and splits by model using `~/.claude/stats-cache.json`. The card counts estimated days the same as measured ones; `/<you>.json` keeps the `estimated` flag per row. To keep exact history, add `"cleanupPeriodDays": 3650` to `~/.claude/settings.json`.
- **Cost** is the API list-price equivalent, not what your subscription costs.

## Commands

| | |
| --- | --- |
| `tokengazer` | Local summary |
| `tokengazer login` | GitHub device login, installs an hourly job (launchd on macOS, crontab on Linux), first push |
| `tokengazer push` | Upload now |
| `tokengazer logout [--delete]` | Remove the hourly job and local key; `--delete` also erases your data from the server |

## Development

```sh
cd cli && npm test
cd server && npm test
cd server && npx wrangler d1 execute tokengazer --local --file schema.sql && npm run dev
TOKENGAZER_HOST=http://localhost:8787 node cli/bin/tokengazer.js push
```

### Deploy

1. Create a GitHub OAuth App with **Enable Device Flow** ticked (no client secret needed), and store its client ID and the Worker URL as repo variables `TOKENGAZER_GITHUB_CLIENT_ID` and `TOKENGAZER_HOST`.
2. `cd server && npx wrangler d1 create tokengazer`, put the id in `wrangler.toml`, then `npx wrangler d1 execute tokengazer --remote --file schema.sql && npm run deploy`.
3. Add an `NPM_TOKEN` repo secret, then publish a GitHub release. `.github/workflows/publish.yml` writes `cli/src/config.js` from the variables and runs `npm publish`.
