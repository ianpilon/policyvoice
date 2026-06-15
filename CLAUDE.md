# CLAUDE.md — project memory for PolicyVoice + Voice Operating System

Two voice-AI demo products in one page for an independent insurance claims firm
(stand-in customer: **Gulf Coast Claims**). Architecture and endpoints live in
`README.md`; this file is the "what you need to know to work on it" layer.

This project was repurposed from a Snap-on auto-shop demo (ShopVoice + In-Van
Co-Pilot). The product copy, data, prompts, and Vapi config are all insurance
now. **Legacy internal names survive in code and infra and are intentionally
left in place** (renaming them is risky and they never reach the user):
- the `shopvoice` object key / `view-shopvoice` / `tab-shopvoice` / `sv-*` IDs in
  `index.html` are the **PolicyVoice** product;
- the `invan` key / `iv-*` IDs / `invan-context/` dir are the **Voice Operating System**;
- `package.json` name `shopvoice`, the Render service `shopvoice-invan-backend`,
  and the repo `shopvoice-invan` keep their names.

## What this is

A single static `index.html` with a header tab switcher between two products,
both on one Express backend (`mcp-servers/unified-server.js`) + flat-file data,
each driven by its own Vapi assistant:

- **PolicyVoice** (default tab) — voice over insurance policy wording, read back
  **word for word, never paraphrased**. Tools: `lookup_coverage`,
  `lookup_endorsement`, `search_policy` → endpoints `/lookup-coverage`,
  `/lookup-endorsement`, `/search-policy`. Corpus:
  `mcp-servers/{policy-context, endorsement-context, policy-forms}`.
- **Voice Operating System** (second tab) — voice over the firm's own operations
  data: claim briefings, adjuster roster, follow-up capture. Tools:
  `claim_briefing`, `roster_check`, `capture_task` → endpoints `/briefing`,
  `/roster-check`, `/capture-task`. Corpus: `mcp-servers/invan-context/`
  (claims.json, roster.json).

Section 02 ("Watch it work") on each tab is an interactive **phone-chat
simulation** (scripted, mirrors the live answers); auto-plays the first question
on scroll, tap others to send.

## The product discipline (PolicyVoice)

The whole pitch is **read the policy wording verbatim, never interpret it.** When
editing the system prompt, the configure tools, or the clause/endorsement data,
preserve this:
- the agent quotes exact text and always gives the citation (form, section, page);
- it flags when an endorsement modifies the base form;
- it never says "covered" / "not covered" and never predicts the claim outcome.

Rewording a policy even slightly is the legal risk the product exists to remove,
so "word for word" is a design requirement, not a nice-to-have.

## Brand / theme

- Accent is blue (`--accent: #2563EB`) to match the pitch deck. A few hardcoded
  `rgba(37,99,235,...)` values in the CSS mirror the accent; change them together.
- Wordmark on both tabs: `Gulf Coast Claims` + the product name.
- `assets/snap-on-logo.png` is a leftover from the clone, not referenced by the
  page (the wordmark is text). Safe to delete; left in place for now.

## Live deployment

- **One Render web service** serves both the page and the API:
  https://shopvoice-invan-backend.onrender.com
  - `/` (and `/index.html`) → the demo page (served by `unified-server.js`)
  - `/assets/*` → static assets. Scoped: `.env`, configure scripts, and system
    prompts are NOT exposed by the static server.
  - PolicyVoice: `/lookup-coverage`, `/lookup-endorsement`, `/search-policy`
  - Voice Operating System: `/briefing`, `/roster-check`, `/capture-task`
  - `/health` → status + data counts; `/reload` → reload corpora; `/data/*` views
- Render config in `render.yaml` (service `shopvoice-invan-backend`, free tier,
  health check `/health`). Push to `main` → Render auto-deploys.
- **Always demo from the https URL, not the local `file://`** — `file://` is an
  opaque origin so the browser re-prompts for mic permission every call. On https
  you grant once ("Allow while visiting the site") and it sticks.

## Keep-warm (avoid cold starts)

Free tier spins down after ~15 min idle; the next hit (and first voice call)
cold-starts ~50s. Two layers, both free:

- **In-code self-ping** — the server pings its own `/health` every 10 min using
  `RENDER_EXTERNAL_URL` (end of `unified-server.js`). No-op locally. Only keeps an
  *already-awake* instance from idling; it CANNOT wake a sleeping one.
- **External pinger (the real never-cold layer)** — a [cron-job.org](https://cron-job.org)
  job hits `/health` every 5 min (`*/5 * * * *`), resetting the 15-min idle timer.

**Free-tier caveats:** "truly never-cold" is not guaranteed (platform restarts);
free web services cap at **750 instance-hours/month** (one always-on service
≈730h fits — do NOT add a second free web service). The only hard guarantee is
upgrading to Starter (~$7/mo), no code change.

## Vapi assistants

Two GPT-4o assistants (one tool group each), pointed at the Render backend. IDs
live in `.env` (`VAPI_ASSISTANT_ID`, `INVAN_ASSISTANT_ID`) and in `index.html`
(`APPS.shopvoice.assistantId`, `APPS.invan.assistantId`). The Vapi PUBLIC key is
in the HTML (client-side, safe).

- **The assistant IDs in `index.html` still point at the pre-repurpose
  (auto-shop) assistants.** Re-run both configure scripts to recreate/repoint
  them at the PolicyVoice + Voice Operating System tools before demoing live voice.
- **Do NOT touch the ReeferVoice assistant `1060e9d6-...`** — different product.
  Always create/patch via the configure scripts with the matching env var set.

## Run / configure recipes

```bash
npm start                                       # page + API on :3001 (PORT overrides)
node configure-complete-system.js <backend-url> # create/update PolicyVoice (VAPI_ASSISTANT_ID)
node configure-invan-system.js   <backend-url>  # create/update Voice Operating System (INVAN_ASSISTANT_ID)
```

- Editing `system-prompt.txt` / `invan-system-prompt.txt` or a configure script
  requires re-running that script to push to Vapi — separate from a Render deploy.
- Editing corpus data: `POST /reload` or restart.

## Secrets

`.env` is gitignored and holds the Vapi private key + assistant IDs. Never commit
it; the static server explicitly does not serve it.
