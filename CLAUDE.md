# CLAUDE.md — project memory for ShopVoice + Operating System Co-Pilot

Two voice-AI demo products in one page, aimed at Snap-on. Architecture and
endpoints live in `README.md`; this file is the "what you need to know to work
on it" layer.

## What this is

A single static `index.html` with a header tab switcher between two products,
both on one Express backend (`mcp-servers/unified-server.js`) + flat-file data,
both driven by their own Vapi assistant:

- **Operating System Co-Pilot** (default tab) — voice over a mobile tool-franchise
  operator's own business data: pre-stop briefings, on-van inventory, order
  capture. Tools: `/briefing`, `/inventory-check`, `/capture-order`. Corpus:
  `mcp-servers/invan-context/` (customers.json, inventory.json).
- **ShopVoice** (secondary tab) — voice over shop reference data: DTC lookups,
  torque/fluid specs, repair procedures. Tools: `/lookup-dtc`, `/lookup-spec`,
  `/search-procedures`. Corpus: `mcp-servers/{dtc-context,spec-context,procedures-rag}`.

Section 02 ("Watch it work") on each tab is an interactive **phone-chat
simulation** (scripted, mirrors the live answers); auto-plays the first question
on scroll, tap others to send.

## Live deployment

- **One Render web service** serves both the page and the API:
  https://shopvoice-invan-backend.onrender.com
  - `/` (and `/index.html`) → the demo page (served by `unified-server.js`)
  - `/assets/*` → static assets (Snap-on logo). Scoped: `.env`, configure
    scripts, and system prompts are NOT exposed by the static server.
  - `/briefing`, `/inventory-check`, `/capture-order` → Co-Pilot tools
  - `/lookup-dtc`, `/lookup-spec`, `/search-procedures` → ShopVoice tools
  - `/health` → status + data counts; `/reload` → reload corpora; `/data/*` views
- Render config in `render.yaml` (service `shopvoice-invan-backend`, free tier,
  health check `/health`). Repo: `github.com/ianpilon/shopvoice-invan` (private).
- Push to `main` → Render auto-deploys.
- **Always demo from the https URL, not the local `file://`** — `file://` is an
  opaque origin so the browser re-prompts for mic permission every call. On https
  you grant once ("Allow while visiting the site") and it sticks.

## Keep-warm (avoid cold starts)

Free tier spins down after ~15 min idle; the next hit (and first voice call)
cold-starts ~50s. Two layers, both free:

- **In-code self-ping** — the server pings its own `/health` every 10 min using
  `RENDER_EXTERNAL_URL` (end of `unified-server.js`). No-op locally. Only keeps an
  *already-awake* instance from idling; it CANNOT wake a sleeping one (the
  `setInterval` dies with the process).
- **External pinger (the real never-cold layer)** — a [cron-job.org](https://cron-job.org)
  job hits `https://shopvoice-invan-backend.onrender.com/health` every 5 min
  (`*/5 * * * *`), resetting the 15-min idle timer so it never spins down.
  Settings: title "ShopVoice/Co-Pilot keep-warm", method GET, schedule every
  5 min, "notify after too many failures" on, request timeout maxed (~30s) for
  the rare mid-wake ping.

**Free-tier limits / caveats:**
- "Truly never-cold" is NOT guaranteed on free: Render still does occasional
  platform restarts/redeploys.
- Free web services cap at **750 instance-hours/month** (one always-on service
  ≈730h fits — do NOT add a second free web service or you'll blow the cap).
- The only hard guarantee is upgrading to Starter (~$7/mo), no code change.

## Vapi assistants

Two GPT-4o assistants (one tool group each), pointed at the Render backend:

- **Operating System Co-Pilot:** `4da59ae1-e4a3-4b7d-9a4f-f2a7788218a5`
  (tools: pre_stop_briefing, inventory_check, capture_order)
- **ShopVoice:** `383bdcd9-cd6c-4840-a9fb-505bb64daf27`
  (tools: lookup_dtc, lookup_spec, search_procedures)
- IDs live in `.env` (`INVAN_ASSISTANT_ID`, `VAPI_ASSISTANT_ID`) and in
  `index.html` (`APPS.invan.assistantId`, `APPS.shopvoice.assistantId`). The Vapi
  PUBLIC key is in the HTML (client-side, safe).
- **Do NOT touch ReeferVoice assistant `1060e9d6-...`** — it's a different
  product (reefervoice-backend). Always create/patch via the configure scripts
  with the matching env var set.

## Run / configure recipes

```bash
npm start                                              # page + API on :3001 (PORT overrides)
node configure-invan-system.js <backend-url>           # create/update the Co-Pilot assistant (INVAN_ASSISTANT_ID)
node configure-complete-system.js <backend-url>        # create/update the ShopVoice assistant (VAPI_ASSISTANT_ID)
```

- Editing `*-system-prompt.txt` or a configure script requires re-running that
  script to push to Vapi — separate from a Render deploy.
- Editing corpus data: `POST /reload` or restart.

## Secrets

`.env` is gitignored and holds the Vapi private key + assistant IDs. Never commit
it; the static server explicitly does not serve it.
