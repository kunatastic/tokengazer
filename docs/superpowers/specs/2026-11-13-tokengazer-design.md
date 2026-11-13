# tokengazer — design

## Intent

GitHub contribution graphs let developers show off commits. tokengazer does the same for AI tokens burned: a heatmap + stat card a developer embeds in their GitHub README, resume or portfolio, kept current automatically. Visual reference: the dark "Contributions — 3.0B TOKENS OVER 68 ACTIVE DAYS" heatmap (orange, shade relative to the user's busiest day) and the stat row (Tokens / Cost / … / Tracking) shared in the brainstorm.

## Goals

- Setup in about two steps: run one command, sign in with GitHub, paste a link.
- Track Claude Code and Codex usage from local logs.
- Public, always-current embeddable image per GitHub user, plus a profile page.
- Store per-user daily totals server-side so a leaderboard/rank can be added later without users re-installing.

## Non-goals (v1)

- Leaderboard / rank (data is kept; UI later).
- Claude Code plugin (TODO, later): only an install shortcut + `/tokengazer` command. The hourly job already covers Claude and Codex, and the 1h image cache makes a session-end push pointless. Revisit if the plugin marketplace matters for discovery.
- Gemini, Cursor, Copilot (Cursor/Copilot keep no local token counts).
- Windows, light theme, custom domain (buy once there is traffic).
- Verifying numbers — they are self-reported, like any local stats tool.

## Anti-goals

- Never upload prompts, code, file paths, project names or session content. Only daily numeric totals per tool and model.
- Never request GitHub repo access — identity only.
- A broken or slow image in a README is a failure even if everything else works.

## Approaches considered

| Approach | Setup steps | Trade-off |
|---|---|---|
| Gist via `gh` CLI, no server | 3–5 | Needs `gh` installed + authed — main drop-off point. No rank ever. |
| Anonymous upload, random URL | 1 | Easiest, but URL isn't the username and can't become a profile. |
| **Own server + GitHub login (chosen)** | 2 | We run a small service; gives username URLs, multi-machine merging, future leaderboard, usage visibility. |

Chosen by the owner: own the server; users push after login; server renders the image.

## Architecture

```
user machine                              server (Cloudflare Worker + D1)
tokengazer login  ── GitHub device flow ─▶ verify GitHub identity, issue API key
tokengazer push   ── daily totals ───────▶ upsert rows
                                           GET /<username>.svg   embeddable card
                                           GET /<username>       profile page
```

### Client — `tokengazer` (npm, Node, zero dependencies)

- `npx tokengazer` — print local stats in the terminal; if not logged in, offer login.
- `tokengazer login` — GitHub OAuth **device flow** (terminal shows a code, user approves in browser). Server exchanges/validates the GitHub token, records the GitHub user id + login, returns a tokengazer API key **per machine** (a random `machine_id` is generated on first login; logging in on a second machine does not revoke the first). Stored in `~/.tokengazer/config.json` (mode 600). Login also installs the hourly job and prints the embed snippet:
  `[![tokens](https://<host>/<username>.svg)](https://<host>/<username>)`
- `tokengazer push` — scan logs, aggregate, POST to server. Idempotent: sends full per-day totals for every day found (not deltas), server replaces them.
- `tokengazer logout` — remove key and scheduled job.
- Schedule: macOS `launchd` agent, Linux user `crontab`, hourly `tokengazer push`.

**Log sources**

- Claude Code: `~/.claude/projects/**/*.jsonl`. Assistant entries carry `message.model`, `message.id`, `requestId`, timestamp and `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). Dedupe on `message.id + requestId` (resumed sessions copy entries).
- Codex: `~/.codex/sessions/**/*.jsonl`. `event_msg` entries of type `token_count` carry `info.last_token_usage` (`input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`); sum `last_token_usage` per event (not `total_token_usage`, which is cumulative). Model comes from the session's turn context (`"model"` field). Skip entries where `info` is null.
- Day bucket = the user's **local** date of the entry timestamp.

**Payload** (one row per day × tool × model):
`{ day, tool: "claude"|"codex", model, input, output, cache_read, cache_write, reasoning }`

**What "tokens" means** (owner-visible number, decided by the builder check):
- Claude: `input + output + cache_read + cache_write` — cache reads included, matching the reference card and how usage tools usually report "tokens burned".
- Codex: `input + output` only. Verified in local logs: `total_tokens = input_tokens + output_tokens`; `cached_input_tokens` is a subset of input and `reasoning_output_tokens` a subset of output, so they are stored (for pricing) but never added again.

Cost is computed **server-side** from a price table, so prices can be fixed without client updates. Unknown models count tokens, $0 cost.

### Server — Cloudflare Worker + D1

- Chosen because README images are fetched by GitHub's image proxy with a short timeout; a host that sleeps (e.g. Render free) would show broken images. Free tier covers early usage.
- Tables: `users(github_id PK, login, created_at)`, `machines(machine_id PK, github_id, api_key_hash, created_at)`, `usage(github_id, machine_id, day, tool, model, input, output, cache_read, cache_write, reasoning, PK(github_id, machine_id, day, tool, model))`. Reads sum across machines.
- `POST /api/push` (Bearer API key → identifies machine): replace that machine's rows for the days sent. Reject rows with negative numbers or dates in the future / before 2023; cap a single day at a sanity ceiling.
- `GET /<login>.svg`: card rendered on request, `Cache-Control: max-age=3600`. Unknown user → a "not tracking yet" card, not a 404 image.
- `GET /<login>`: HTML profile page with the same heatmap (year picker), stat cards and a per-tool/per-model breakdown.
- Host: v1 serves on `tokengazer.<account>.workers.dev`. When a domain is bought later, it is added as a second route and the `workers.dev` route stays live forever, so already-pasted embeds never break; new snippets use the domain.
- GitHub login renames: key on `github_id`, refresh `login` on each push.

### The card (SVG)

- Last 365 days heatmap, combined across tools, 5 shades, shade relative to the user's busiest day, Mon/Wed/Fri labels, month labels.
- Headline: `3.0B TOKENS OVER 68 ACTIVE DAYS`, plus a split line `2.1B Claude · 0.9B Codex`.
- Stat cards: Tokens (all time), Cost (API-equivalent), Active days, Current streak.
- Dark theme, orange scale; small "tokengazer" mark. Monospace system font stack only (GitHub's proxy strips external fonts).

## Repo layout

Single repo `kunatastic/tokengazer`: `cli/` (npm package), `server/` (Worker).

## Privacy

A short privacy note in the README and on the profile page: what is sent (daily numeric totals per tool/model), what never is, how to delete (`tokengazer logout --delete` removes server rows).

## Left to the builder

- Exact price table values and model-name matching.
- Exact SVG dimensions/colours within the reference look.
- Sanity ceiling value; rate limiting on `/api/push`.
- Test strategy (at minimum: log-parsing fixtures for both tools, dedupe, aggregation).
