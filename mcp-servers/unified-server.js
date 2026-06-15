require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Vapi sends tool calls in a few shapes; pull a named argument out of any of them.
function extractArg(body, name) {
  return body[name]
    || body.parameters?.[name]
    || body.message?.toolCalls?.[0]?.function?.arguments?.[name]
    || body.message?.toolCallList?.[0]?.function?.arguments?.[name];
}

function extractToolCallId(body) {
  return body.message?.toolCallList?.[0]?.id || 'unknown';
}

function vapiResult(res, toolCallId, result, status = 200) {
  return res.status(status).json({ results: [{ toolCallId, result }] });
}

// ============================================
// DTC (DIAGNOSTIC TROUBLE CODE) FUNCTIONALITY
// ============================================

const DTC_DB_PATH = path.join(__dirname, 'dtc-context/dtc-database.json');

function loadDtcDB() {
  if (fs.existsSync(DTC_DB_PATH)) {
    return JSON.parse(fs.readFileSync(DTC_DB_PATH, 'utf8'));
  }
  return { dtcs: [] };
}

let dtcDB = loadDtcDB();

// Normalize spoken/typed forms: "p0420", "P 0420", "P oh four twenty" (LLM usually
// passes digits, but handle "P420" by re-inserting the dropped leading zero).
function normalizeCode(s) {
  let code = String(s || '').toUpperCase()
    .replace(/\bOH\b/g, '0')
    .replace(/\bZERO\b/g, '0')
    .replace(/[^A-Z0-9]/g, '');
  const short = code.match(/^([PBCU])(\d{3})$/);
  if (short) code = `${short[1]}0${short[2]}`;
  return code;
}

function findDtc(code) {
  const target = normalizeCode(code);
  if (!target) return null;

  let dtc = dtcDB.dtcs.find(d => normalizeCode(d.code) === target);
  if (dtc) return dtc;

  // Digits-only fallback: "0420" or "420"
  const digits = target.replace(/[^0-9]/g, '');
  if (digits) {
    dtc = dtcDB.dtcs.find(d => d.code.replace(/[^0-9]/g, '') === digits.padStart(4, '0'));
    if (dtc) return dtc;
  }

  return null;
}

function describeDtc(d) {
  const fixes = d.real_fixes
    .map((f, i) => `${i + 1}. ${f.fix} (${f.frequency})`)
    .join(' ');
  return `${d.code} is ${d.name} — ${d.system} system, ${d.severity} severity. ${d.description} ` +
    `Common causes: ${d.common_causes.join('; ')}. ` +
    `Verified fixes ranked by frequency: ${fixes} ` +
    `Tech note: ${d.tech_notes}`;
}

app.post('/lookup-dtc', (req, res) => {
  console.log('\n📥 Full request body:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const code = extractArg(req.body, 'code');

  console.log(`\n🔧 DTC lookup: "${code}"`);
  console.log(`   Tool Call ID: ${toolCallId}`);

  if (!code) {
    console.log('❌ No code found in request body');
    return vapiResult(res, toolCallId, 'Error: code parameter is required', 400);
  }

  const dtc = findDtc(code);

  if (!dtc) {
    console.log('   ❌ Not found');
    return vapiResult(res, toolCallId,
      `I don't have ${code} in this demo database. It covers about thirty of the most common powertrain, EVAP, network, and chassis codes.`);
  }

  console.log(`   ✅ Found: ${dtc.code} (${dtc.name})`);
  return vapiResult(res, toolCallId, describeDtc(dtc));
});

// ============================================
// TORQUE / FLUID SPEC FUNCTIONALITY
// ============================================

const SPEC_DB_PATH = path.join(__dirname, 'spec-context/spec-database.json');

function loadSpecDB() {
  if (fs.existsSync(SPEC_DB_PATH)) {
    return JSON.parse(fs.readFileSync(SPEC_DB_PATH, 'utf8'));
  }
  return { specs: [] };
}

let specDB = loadSpecDB();

function searchSpecs(query) {
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter(word => word.length > 2);

  const results = specDB.specs.map(spec => {
    let score = 0;
    const vehicle = spec.vehicle.toLowerCase();
    const engine = (spec.engine || '').toLowerCase();
    const component = spec.component.toLowerCase();

    keywords.forEach(keyword => {
      if (vehicle.includes(keyword)) score += 5;
      if (engine.includes(keyword)) score += 4;
      if (component.includes(keyword)) score += 6;
      if ((spec.notes || '').toLowerCase().includes(keyword)) score += 1;
    });

    return { ...spec, score };
  })
  .filter(s => s.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 4);

  return results;
}

function describeSpec(s) {
  let line = `${s.vehicle}${s.engine && s.engine !== 'all' ? ` (${s.engine})` : ''} — ${s.component}: ${s.spec}.`;
  if (s.notes) line += ` ${s.notes}`;
  return line;
}

app.post('/lookup-spec', (req, res) => {
  console.log('\n📥 Spec lookup request:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const query = extractArg(req.body, 'query');

  console.log(`\n🔩 Spec lookup: "${query}"`);
  console.log(`   Tool Call ID: ${toolCallId}`);

  if (!query) {
    return vapiResult(res, toolCallId, 'Error: query parameter is required', 400);
  }

  const results = searchSpecs(query);

  if (results.length === 0) {
    return vapiResult(res, toolCallId,
      'No spec found for that vehicle and component in this demo database. It covers common torque specs and fluid capacities for F-150, Silverado, Camry, Civic, RAM 1500, Super Duty, and RAV4.');
  }

  console.log(`   ✅ Found ${results.length} specs`);
  return vapiResult(res, toolCallId, results.map(describeSpec).join(' '));
});

// ============================================
// REPAIR PROCEDURE SEARCH FUNCTIONALITY
// ============================================

const PROCEDURE_DOCS_PATH = path.join(__dirname, 'procedures-rag');
let documents = [];

function loadDocuments() {
  try {
    if (!fs.existsSync(PROCEDURE_DOCS_PATH)) {
      console.log(`⚠️  Procedure docs directory not found: ${PROCEDURE_DOCS_PATH}`);
      return;
    }

    const files = fs.readdirSync(PROCEDURE_DOCS_PATH);
    documents = [];

    files.forEach(file => {
      if (file.endsWith('.txt') || file.endsWith('.md')) {
        const content = fs.readFileSync(path.join(PROCEDURE_DOCS_PATH, file), 'utf8');

        // Split on ## headers to create clean section boundaries
        const sections = content.split(/(?=##\s)/g).filter(section => section.trim().length > 0);

        sections.forEach((section, index) => {
          // Further split large sections on ### subheaders
          const subsections = section.split(/(?=###\s)/g).filter(sub => sub.trim().length > 0);

          subsections.forEach((subsection, subIndex) => {
            documents.push({
              id: `${file}-section-${index}-${subIndex}`,
              filename: file,
              content: subsection.trim()
            });
          });
        });
      }
    });

    console.log(`✅ Loaded ${documents.length} procedure chunks from ${files.length} files`);
  } catch (error) {
    console.error('Error loading documents:', error.message);
  }
}

function searchDocuments(query) {
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(' ').filter(word => word.length > 3);

  const results = documents.map(doc => {
    let score = 0;
    const contentLower = doc.content.toLowerCase();
    const firstLine = doc.content.split('\n')[0].toLowerCase();
    const filenameLower = doc.filename.toLowerCase();

    keywords.forEach(keyword => {
      const matches = (contentLower.match(new RegExp(keyword, 'g')) || []).length;
      score += matches;

      if (filenameLower.includes(keyword)) {
        score += 8;
      }

      if (firstLine.includes(keyword)) {
        score += 5;
      }

      if (firstLine.startsWith('##') && firstLine.includes(keyword)) {
        score += 10;
      }
    });

    if (doc.content.length < 100) {
      score = score * 0.5;
    }

    return { ...doc, score };
  })
  .filter(doc => doc.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 3);

  return results;
}

app.post('/search-procedures', (req, res) => {
  console.log('\n📥 Full request body:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const query = extractArg(req.body, 'query');

  console.log(`\n🔍 Procedure search: "${query}"`);
  console.log(`   Tool Call ID: ${toolCallId}`);

  if (!query) {
    console.log('❌ No query found in request body');
    return vapiResult(res, toolCallId, 'Error: query parameter is required', 400);
  }

  const results = searchDocuments(query);

  if (results.length === 0) {
    console.log('   ❌ No relevant procedures found');
    return vapiResult(res, toolCallId,
      'No matching procedure in this demo database. It covers crank relearns, front brake jobs, TPMS relearns, serpentine belts, O2 sensors, and EVAP smoke testing.');
  }

  // Combine results into single-line text (Vapi requirement: no line breaks)
  const combinedContent = results.map(r => r.content.replace(/\n+/g, ' ')).join(' ');

  console.log(`   ✅ Found ${results.length} relevant sections`);
  console.log(`   Files: ${[...new Set(results.map(r => r.filename))].join(', ')}`);

  return vapiResult(res, toolCallId, combinedContent);
});

// ============================================
// IN-VAN CO-PILOT FUNCTIONALITY
// (second product: voice layer on the operator's own business data)
// ============================================

const INVAN_CUSTOMERS_PATH = path.join(__dirname, 'invan-context/customers.json');
const INVAN_INVENTORY_PATH = path.join(__dirname, 'invan-context/inventory.json');

function loadInvanCustomers() {
  if (fs.existsSync(INVAN_CUSTOMERS_PATH)) {
    return JSON.parse(fs.readFileSync(INVAN_CUSTOMERS_PATH, 'utf8'));
  }
  return { stops: [] };
}

function loadInvanInventory() {
  if (fs.existsSync(INVAN_INVENTORY_PATH)) {
    return JSON.parse(fs.readFileSync(INVAN_INVENTORY_PATH, 'utf8'));
  }
  return { inventory: [] };
}

let invanCustomers = loadInvanCustomers();
let invanInventory = loadInvanInventory();
// Captured orders/to-dos live in memory for the demo (voice-as-commit). A real
// build would write these to the franchise operating system of record.
let invanCaptures = [];

// ---- 5.1 Pre-stop briefing (voice-as-read) ----

// Match a query to a stop, or to a specific customer within a stop.
function findStopOrCustomer(query) {
  const q = String(query || '').toLowerCase();
  if (!q) return null;

  for (const stop of invanCustomers.stops) {
    for (const c of stop.customers) {
      const name = c.name.toLowerCase();
      const firstName = name.split(' ')[0];
      if (q.includes(name) || (firstName.length > 2 && q.includes(firstName))) {
        return { stop, customer: c };
      }
    }
  }

  const keywords = q.split(/\s+/).filter(w => w.length > 2);
  let best = null, bestScore = 0;
  for (const stop of invanCustomers.stops) {
    const loc = stop.location.toLowerCase();
    let score = 0;
    keywords.forEach(k => { if (loc.includes(k)) score += 3; });
    if (score > bestScore) { bestScore = score; best = stop; }
  }
  return best ? { stop: best, customer: null } : null;
}

function money(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function briefCustomer(c) {
  const parts = [`${c.name}, ${c.role}:`];

  if (c.balance > 0) {
    const due = c.past_due_days > 0 ? `, ${c.past_due_days} days past due` : '';
    parts.push(`owes ${money(c.balance)} dollars${due}.`);
  } else {
    parts.push('paid up.');
  }

  c.open_orders.forEach(o => parts.push(`Special order — ${o.item}, ${o.status}.`));
  c.warranty_items.forEach(w => parts.push(`Warranty — ${w.item}, ${w.status}.`));
  if (c.last_visit_note) parts.push(`Last visit: ${c.last_visit_note}`);

  return parts.join(' ');
}

function buildBriefing(match) {
  const { stop, customer } = match;
  if (customer) {
    return `At ${stop.location}. ${briefCustomer(customer)}`;
  }
  const count = stop.customers.length;
  const header = `${stop.location}. ${count} ${count === 1 ? 'customer' : 'customers'} here.`;
  return `${header} ${stop.customers.map(briefCustomer).join(' ')}`;
}

app.post('/briefing', (req, res) => {
  console.log('\n📥 Briefing request:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const stopQuery = extractArg(req.body, 'stop');

  console.log(`\n📋 Pre-stop briefing: "${stopQuery}"`);

  if (!stopQuery) {
    return vapiResult(res, toolCallId, 'Error: stop parameter is required', 400);
  }

  const match = findStopOrCustomer(stopQuery);

  if (!match) {
    const stops = invanCustomers.stops.map(s => s.location).join(', ');
    return vapiResult(res, toolCallId,
      `I don't have a stop or customer matching that in this demo. Stops on the route: ${stops}.`);
  }

  console.log(`   ✅ Briefing: ${match.stop.location}${match.customer ? ' / ' + match.customer.name : ''}`);
  return vapiResult(res, toolCallId, buildBriefing(match));
});

// ---- 5.3 Inventory check (voice-as-read) ----

function searchInventory(query) {
  const q = String(query || '').toLowerCase();
  const keywords = q.split(/\s+/).filter(w => w.length > 1);

  return invanInventory.inventory.map(item => {
    let score = 0;
    const name = item.item.toLowerCase();
    keywords.forEach(k => {
      if (name.includes(k)) score += 4;
      if ((item.category || '').toLowerCase().includes(k)) score += 1;
    });
    return { ...item, score };
  })
  .filter(i => i.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 3);
}

function describeInventory(i) {
  if (i.on_van <= 0) {
    return `${i.item}: none on the van right now. Minimum is ${i.min}. Want me to add it to a reorder?`;
  }
  const where = i.location ? ` in ${i.location}` : '';
  const low = i.on_van < i.min ? ` That's below your minimum of ${i.min} — flag for reorder.` : '';
  const unit = i.on_van === 1 ? 'one' : i.on_van;
  return `${i.item}: ${unit} on the van${where}.${low}`;
}

app.post('/inventory-check', (req, res) => {
  console.log('\n📥 Inventory request:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const query = extractArg(req.body, 'item');

  console.log(`\n📦 Inventory check: "${query}"`);

  if (!query) {
    return vapiResult(res, toolCallId, 'Error: item parameter is required', 400);
  }

  const results = searchInventory(query);

  if (results.length === 0) {
    return vapiResult(res, toolCallId,
      "I don't see that on the van inventory list in this demo. Try the item name like '3/8 torque wrench' or '18 volt ratchet'.");
  }

  console.log(`   ✅ Found ${results.length} inventory matches`);
  return vapiResult(res, toolCallId, results.map(describeInventory).join(' '));
});

// ---- 5.2 Windshield-time capture (voice-as-commit) ----

app.post('/capture-order', (req, res) => {
  console.log('\n📥 Capture request:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const customer = extractArg(req.body, 'customer');
  const item = extractArg(req.body, 'item');
  const action = extractArg(req.body, 'action');
  const date = extractArg(req.body, 'date');

  console.log(`\n📝 Capture: customer="${customer}" item="${item}" action="${action}" date="${date}"`);

  if (!item && !action) {
    return vapiResult(res, toolCallId, 'Error: I need at least an item or an action to capture.', 400);
  }

  const record = {
    id: `cap-${invanCaptures.length + 1}`,
    customer: customer || null,
    item: item || null,
    action: action || null,
    date: date || null,
    capturedAt: new Date().toISOString()
  };
  invanCaptures.push(record);

  // Spoken read-back for confirmation (FR-6: confirm before/at commit).
  const bits = [];
  if (action) bits.push(action);
  if (item) bits.push(item);
  let line = bits.join(', ');
  if (customer) line += ` for ${customer}`;
  if (date) line += `, ${date}`;

  console.log(`   ✅ Captured ${record.id}`);
  return vapiResult(res, toolCallId,
    `Logged: ${line}. That's saved to your follow-ups. Anything else?`);
});

// ============================================
// UTILITY ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    dtcs: dtcDB.dtcs.length,
    specs: specDB.specs.length,
    procedureChunks: documents.length,
    invanStops: invanCustomers.stops.length,
    invanInventory: invanInventory.inventory.length,
    invanCaptures: invanCaptures.length,
    message: 'ShopVoice + In-Van Co-Pilot backend is running'
  });
});

// ============================================
// DATA BROWSER ENDPOINTS (read-only views of what the AI sees)
// ============================================

app.get('/data/dtcs', (req, res) => {
  res.json({ dtcs: dtcDB.dtcs });
});

app.get('/data/specs', (req, res) => {
  res.json({ specs: specDB.specs });
});

app.get('/data/procedures', (req, res) => {
  const grouped = {};
  for (const doc of documents) {
    if (!grouped[doc.filename]) grouped[doc.filename] = [];
    grouped[doc.filename].push({ id: doc.id, content: doc.content });
  }
  const files = Object.entries(grouped).map(([filename, chunks]) => ({ filename, chunks }));
  res.json({ files, totalChunks: documents.length });
});

app.get('/data/customers', (req, res) => {
  res.json({ stops: invanCustomers.stops });
});

app.get('/data/inventory', (req, res) => {
  res.json({ inventory: invanInventory.inventory });
});

app.get('/data/captures', (req, res) => {
  res.json({ captures: invanCaptures });
});

app.post('/reload', (req, res) => {
  dtcDB = loadDtcDB();
  specDB = loadSpecDB();
  loadDocuments();
  invanCustomers = loadInvanCustomers();
  invanInventory = loadInvanInventory();
  res.json({
    success: true,
    dtcs: dtcDB.dtcs.length,
    specs: specDB.specs.length,
    procedureChunks: documents.length,
    invanStops: invanCustomers.stops.length,
    invanInventory: invanInventory.inventory.length,
    message: 'All data reloaded'
  });
});

// ============================================
// STATIC FRONTEND (serve the demo page + assets)
// Scoped to index.html and /assets so .env, configure scripts, and
// system prompts are never exposed by the static server.
// ============================================

const SITE_ROOT = path.join(__dirname, '..');
app.use('/assets', express.static(path.join(SITE_ROOT, 'assets')));
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(SITE_ROOT, 'index.html'));
});

// ============================================
// SERVER STARTUP
// ============================================

loadDocuments();

app.listen(port, () => {
  console.log('\n🚀 ShopVoice - Backend');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Server URL: http://localhost:${port}`);
  console.log('');
  console.log('📋 ShopVoice endpoints:');
  console.log('  🔧 POST /lookup-dtc        - Diagnostic trouble code lookup');
  console.log('  🔩 POST /lookup-spec       - Torque / fluid spec lookup');
  console.log('  📚 POST /search-procedures - Repair procedure search');
  console.log('📋 In-Van Co-Pilot endpoints:');
  console.log('  📋 POST /briefing          - Pre-stop briefing');
  console.log('  📦 POST /inventory-check   - On-van inventory check');
  console.log('  📝 POST /capture-order     - Capture order / to-do');
  console.log('  💚 GET  /health            - Health check');
  console.log('  🔄 POST /reload            - Reload data');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('📊 Data Loaded:');
  console.log(`  DTCs: ${dtcDB.dtcs.length} · Specs: ${specDB.specs.length} · Procedures: ${documents.length}`);
  console.log(`  In-Van stops: ${invanCustomers.stops.length} · Inventory items: ${invanInventory.inventory.length}`);
  console.log('');
  console.log('🎉 Ready for Vapi integration!\n');

  // Keep-warm: on Render's free tier the instance spins down after ~15 min
  // idle and the next visitor sees a ~50s cold-start. Render sets
  // RENDER_EXTERNAL_URL on deployed services; we ping our own /health every
  // 10 min so an already-awake instance never goes idle. No-op locally (var
  // unset). This cannot WAKE a sleeping instance — the external cron-job.org
  // pinger is the real never-cold layer.
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    const KEEP_WARM_MS = 10 * 60 * 1000;
    setInterval(() => {
      fetch(`${selfUrl}/health`)
        .then(() => console.log('⏰ keep-warm ping ok'))
        .catch(e => console.log('⏰ keep-warm ping failed:', e.message));
    }, KEEP_WARM_MS);
    console.log(`⏰ keep-warm enabled: pinging ${selfUrl}/health every 10 min\n`);
  }
});
