# ShopVoice

A forwardable "talk to your shop data" voice AI demo, aimed at Snap-on. A viewer opens one link, taps to talk, and asks the demo's stand-in technical corpus a question out loud: DTC lookups, torque specs, repair procedures. The page is designed to explain itself in 90 seconds without anyone presenting it, and ends with a "where this fits inside Snap-on" routing map.

Remixed from the RTL Voice Business Assistant architecture (Vapi + Express + flat-file data).

## Architecture

```
Browser (index.html, Vapi Web SDK tap-to-talk)
  → Vapi (STT/TTS + GPT-4o function calling)
    → Express server (mcp-servers/unified-server.js)
      → flat-file demo corpus
```

### Backend endpoints

| Endpoint | Purpose |
|---|---|
| `POST /lookup-dtc` | DTC lookup. Tolerant matching across "P0420", "p 420", "P oh four twenty". |
| `POST /lookup-spec` | Keyword-scored torque/fluid spec search by vehicle + component. |
| `POST /search-procedures` | Keyword-scored search over procedure markdown chunked on `##` / `###` headers. |
| `GET /health` | Counts of DTCs, specs, and procedure chunks loaded. |
| `POST /reload` | Reload all three data sources without restarting. |
| `GET /data/dtcs` `/data/specs` `/data/procedures` | Read-only views of what the AI sees. |

### Demo corpus (stand-in, no Snap-on data)

- `mcp-servers/dtc-context/dtc-database.json` — ~30 common DTCs with ranked "verified real fixes" (SureTrack-shaped).
- `mcp-servers/spec-context/spec-database.json` — ~40 torque/fluid specs across F-150, Silverado, Camry, Civic, RAM 1500, Super Duty, RAV4.
- `mcp-servers/procedures-rag/` — 6 procedure docs (crank relearn, front brakes, TPMS, serpentine belt, O2 sensors, EVAP smoke test).

Spec values are demo-plausible, not service-manual-verified. The point is the pattern, not the numbers.

## Setup

```bash
npm install
npm start          # backend on PORT (default 3001)
```

### Wire up Vapi (one time)

1. Copy `.env.example` to `.env`, set `VAPI_API_KEY`, leave `VAPI_ASSISTANT_ID` blank.
2. `node configure-complete-system.js <backend-url>` — creates a NEW ShopVoice assistant and prints its ID.
3. Put that ID in `.env` (`VAPI_ASSISTANT_ID=...`) so future runs update instead of creating duplicates.
4. Put the same ID in `index.html` (`VAPI_ASSISTANT_ID` constant).

For local testing, tunnel the backend and pass the tunnel URL:

```bash
ngrok http 3001
node configure-complete-system.js https://your-tunnel.ngrok-free.app
```

## Deployment

- **Backend:** Render via `render.yaml` (service `shopvoice-backend`, free tier, `/health` health check).
- **Frontend:** `index.html` is fully static — GitHub Pages or any static host.
- After deploying the backend, re-run `node configure-complete-system.js https://shopvoice-backend.onrender.com` so the Vapi tools point at the live URL.

## Updating data

Edit the JSON/markdown under `mcp-servers/`, then `POST /reload`. Editing `system-prompt.txt` requires re-running the configure script to push it to Vapi.
