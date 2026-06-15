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
// POLICY COVERAGE CLAUSE LOOKUP (voice-as-read, verbatim)
// ============================================

const POLICY_DB_PATH = path.join(__dirname, 'policy-context/policy-database.json');

function loadPolicyDB() {
  if (fs.existsSync(POLICY_DB_PATH)) {
    return JSON.parse(fs.readFileSync(POLICY_DB_PATH, 'utf8'));
  }
  return { clauses: [] };
}

let policyDB = loadPolicyDB();

// Keyword-scored match across topic + keywords. Returns the single best clause so
// the agent reads ONE provision verbatim rather than splicing several together.
function findClause(topic) {
  const q = String(topic || '').toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;

  let best = null, bestScore = 0;
  for (const c of policyDB.clauses) {
    let score = 0;
    const topicLower = c.topic.toLowerCase();
    const kws = (c.keywords || []).map(k => k.toLowerCase());
    words.forEach(w => {
      if (topicLower.includes(w)) score += 4;
      if (kws.some(k => k.includes(w) || w.includes(k))) score += 5;
    });
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore > 0 ? best : null;
}

// Read the clause WORD FOR WORD with its citation. No interpretation, no coverage call.
function describeClause(c) {
  let out = `Reading from ${c.form}, ${c.section}, page ${c.page}. Quote: ${c.verbatim} End quote.`;
  if (c.endorsement_note) out += ` Endorsement note: ${c.endorsement_note}`;
  out += ` That is the wording as written. I am not making the coverage call.`;
  return out;
}

app.post('/lookup-coverage', (req, res) => {
  console.log('\n📥 Full request body:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const topic = extractArg(req.body, 'topic');

  console.log(`\n📖 Coverage lookup: "${topic}"`);
  console.log(`   Tool Call ID: ${toolCallId}`);

  if (!topic) {
    console.log('❌ No topic found in request body');
    return vapiResult(res, toolCallId, 'Error: topic parameter is required', 400);
  }

  const clause = findClause(topic);

  if (!clause) {
    console.log('   ❌ Not found');
    return vapiResult(res, toolCallId,
      `I don't have a clause on that in this policy. The SE Mutual Homeowner's Package covers the all-risks insuring agreement, water and sewer backup, flood and waves, wind-driven rain to the interior, fungi and mould, by-law and increased cost of construction, additional living expense, basis of claim payment and deductible, and requirements after loss.`);
  }

  console.log(`   ✅ Found clause: ${clause.topic}`);
  return vapiResult(res, toolCallId, describeClause(clause));
});

// ============================================
// ENDORSEMENT (ADD-ON) LOOKUP (voice-as-read, verbatim)
// ============================================

const ENDORSEMENT_DB_PATH = path.join(__dirname, 'endorsement-context/endorsement-database.json');

function loadEndorsementDB() {
  if (fs.existsSync(ENDORSEMENT_DB_PATH)) {
    return JSON.parse(fs.readFileSync(ENDORSEMENT_DB_PATH, 'utf8'));
  }
  return { endorsements: [] };
}

let endorsementDB = loadEndorsementDB();

function searchEndorsements(query) {
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter(word => word.length > 2);

  const results = endorsementDB.endorsements.map(e => {
    let score = 0;
    const name = e.name.toLowerCase();
    const form = (e.form || '').toLowerCase();
    const kws = (e.keywords || []).map(k => k.toLowerCase());

    keywords.forEach(keyword => {
      if (name.includes(keyword)) score += 5;
      if (form.includes(keyword)) score += 4;
      if (kws.some(k => k.includes(keyword) || keyword.includes(k))) score += 6;
    });

    return { ...e, score };
  })
  .filter(s => s.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 2);

  return results;
}

// Read the endorsement WORD FOR WORD and flag how it modifies the base form.
function describeEndorsement(e) {
  let out = `Endorsement ${e.name}, form ${e.form}, page ${e.page}. Quote: ${e.verbatim} End quote.`;
  if (e.modifies) out += ` How it changes the base policy: ${e.modifies}`;
  return out;
}

app.post('/lookup-endorsement', (req, res) => {
  console.log('\n📥 Endorsement lookup request:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const query = extractArg(req.body, 'query');

  console.log(`\n📎 Endorsement lookup: "${query}"`);
  console.log(`   Tool Call ID: ${toolCallId}`);

  if (!query) {
    return vapiResult(res, toolCallId, 'Error: query parameter is required', 400);
  }

  const results = searchEndorsements(query);

  if (results.length === 0) {
    return vapiResult(res, toolCallId,
      "No endorsement on that in this policy. The SE Mutual Homeowner's Package includes the Sewer Backup Endorsement, the Building By-Law Coverage Endorsement, and the Restriction of Coverage endorsements for roof, ice damming, and collapse.");
  }

  console.log(`   ✅ Found ${results.length} endorsements`);
  return vapiResult(res, toolCallId, results.map(describeEndorsement).join(' '));
});

// ============================================
// POLICY FORM DOCUMENT SEARCH (voice-as-read over full forms)
// ============================================

const POLICY_FORMS_PATH = path.join(__dirname, 'policy-forms');
let documents = [];

function loadDocuments() {
  try {
    if (!fs.existsSync(POLICY_FORMS_PATH)) {
      console.log(`⚠️  Policy forms directory not found: ${POLICY_FORMS_PATH}`);
      return;
    }

    const files = fs.readdirSync(POLICY_FORMS_PATH);
    documents = [];

    files.forEach(file => {
      if (file.endsWith('.txt') || file.endsWith('.md')) {
        const content = fs.readFileSync(path.join(POLICY_FORMS_PATH, file), 'utf8');

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

app.post('/search-policy', (req, res) => {
  console.log('\n📥 Full request body:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const query = extractArg(req.body, 'query');

  console.log(`\n🔍 Policy form search: "${query}"`);
  console.log(`   Tool Call ID: ${toolCallId}`);

  if (!query) {
    console.log('❌ No query found in request body');
    return vapiResult(res, toolCallId, 'Error: query parameter is required', 400);
  }

  const results = searchDocuments(query);

  if (results.length === 0) {
    console.log('   ❌ No relevant policy sections found');
    return vapiResult(res, toolCallId,
      "No matching section in this policy. The SE Mutual Homeowner's Package covers Section I property coverage, Section III statutory conditions, and Section IV and V restrictions and endorsements.");
  }

  // Combine results into single-line text (Vapi requirement: no line breaks)
  const combinedContent = results.map(r => r.content.replace(/\n+/g, ' ')).join(' ');

  console.log(`   ✅ Found ${results.length} relevant sections`);
  console.log(`   Files: ${[...new Set(results.map(r => r.filename))].join(', ')}`);

  return vapiResult(res, toolCallId, combinedContent);
});

// ============================================
// OPERATIONS CO-PILOT FUNCTIONALITY
// (second product: voice layer on the claims firm's own operations data)
// ============================================

const INVAN_CLAIMS_PATH = path.join(__dirname, 'invan-context/claims.json');
const INVAN_ROSTER_PATH = path.join(__dirname, 'invan-context/roster.json');

function loadInvanClaims() {
  if (fs.existsSync(INVAN_CLAIMS_PATH)) {
    return JSON.parse(fs.readFileSync(INVAN_CLAIMS_PATH, 'utf8'));
  }
  return { files: [] };
}

function loadInvanRoster() {
  if (fs.existsSync(INVAN_ROSTER_PATH)) {
    return JSON.parse(fs.readFileSync(INVAN_ROSTER_PATH, 'utf8'));
  }
  return { adjusters: [] };
}

let invanClaims = loadInvanClaims();
let invanRoster = loadInvanRoster();
// Captured follow-ups/tasks live in memory for the demo (voice-as-commit). A real
// build would write these to the firm's claims-management system of record.
let invanCaptures = [];

// ---- Claim file briefing (voice-as-read) ----

// Match a query to a claim file by claim number, claimant name, or location.
function findClaim(query) {
  const q = String(query || '').toLowerCase();
  if (!q) return null;

  for (const f of invanClaims.files) {
    const claimant = f.claimant.toLowerCase();
    const firstWord = claimant.split(' ')[0];
    const claimNo = f.claim_no.toLowerCase();
    if (q.includes(claimNo) || q.includes(claimant) || (firstWord.length > 2 && q.includes(firstWord))) {
      return f;
    }
  }

  const keywords = q.split(/\s+/).filter(w => w.length > 2);
  let best = null, bestScore = 0;
  for (const f of invanClaims.files) {
    const hay = `${f.location} ${f.insurer} ${f.loss_type}`.toLowerCase();
    let score = 0;
    keywords.forEach(k => { if (hay.includes(k)) score += 3; });
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore > 0 ? best : null;
}

function briefClaim(f) {
  const parts = [`Claim ${f.claim_no}, ${f.claimant}, ${f.role}.`];
  parts.push(`Insurer ${f.insurer}, ${f.policy_form}.`);
  parts.push(`${f.loss_type}, reported ${f.loss_date}.`);
  parts.push(`Status: ${f.status}.`);
  if (f.deadline) parts.push(`${f.deadline} due in ${f.deadline_days} days.`);
  parts.push(`Assigned to ${f.adjuster}.`);
  if (f.note) parts.push(`Note: ${f.note}`);
  return parts.join(' ');
}

app.post('/briefing', (req, res) => {
  console.log('\n📥 Briefing request:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const claimQuery = extractArg(req.body, 'claim');

  console.log(`\n📋 Claim briefing: "${claimQuery}"`);

  if (!claimQuery) {
    return vapiResult(res, toolCallId, 'Error: claim parameter is required', 400);
  }

  const file = findClaim(claimQuery);

  if (!file) {
    const files = invanClaims.files.map(f => `${f.claim_no} (${f.claimant})`).join(', ');
    return vapiResult(res, toolCallId,
      `I don't have a claim file matching that in this demo. Open files: ${files}.`);
  }

  console.log(`   ✅ Briefing: ${file.claim_no} / ${file.claimant}`);
  return vapiResult(res, toolCallId, briefClaim(file));
});

// ---- Adjuster roster check (voice-as-read) ----

function searchRoster(query) {
  const q = String(query || '').toLowerCase();
  const keywords = q.split(/\s+/).filter(w => w.length > 2);

  return invanRoster.adjusters.map(a => {
    let score = 0;
    const region = a.region.toLowerCase();
    const licenses = (a.licenses || '').toLowerCase();
    keywords.forEach(k => {
      if (region.includes(k)) score += 5;
      if (licenses.includes(k)) score += 2;
      if (a.name.toLowerCase().includes(k)) score += 4;
    });
    return { ...a, score };
  })
  .filter(a => a.score > 0)
  .sort((a, b) => b.score - a.score);
}

function describeAdjuster(a) {
  if (a.status === 'available') {
    return `${a.name}, licensed in ${a.licenses}, ${a.open_files} open files — available.`;
  }
  if (a.status === 'full') {
    return `${a.name} is full at ${a.open_files} files — don't assign more.`;
  }
  return `${a.name}, ${a.open_files} open files — deployed but not maxed.`;
}

app.post('/roster-check', (req, res) => {
  console.log('\n📥 Roster request:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const query = extractArg(req.body, 'region');

  console.log(`\n👥 Roster check: "${query}"`);

  if (!query) {
    return vapiResult(res, toolCallId, 'Error: region parameter is required', 400);
  }

  const results = searchRoster(query);

  if (results.length === 0) {
    const regions = [...new Set(invanRoster.adjusters.map(a => a.region))].join(', ');
    return vapiResult(res, toolCallId,
      `No adjusters matching that in this demo roster. Regions covered: ${regions}.`);
  }

  const available = results.filter(a => a.status === 'available');
  const header = `${available.length} available. `;
  console.log(`   ✅ Found ${results.length} adjusters (${available.length} available)`);
  return vapiResult(res, toolCallId, header + results.map(describeAdjuster).join(' '));
});

// ---- Follow-up / task capture (voice-as-commit) ----

app.post('/capture-task', (req, res) => {
  console.log('\n📥 Capture request:', JSON.stringify(req.body, null, 2));

  const toolCallId = extractToolCallId(req.body);
  const claim = extractArg(req.body, 'claim');
  const task = extractArg(req.body, 'task');
  const action = extractArg(req.body, 'action');
  const date = extractArg(req.body, 'date');

  console.log(`\n📝 Capture: claim="${claim}" task="${task}" action="${action}" date="${date}"`);

  if (!task && !action) {
    return vapiResult(res, toolCallId, 'Error: I need at least a task or an action to capture.', 400);
  }

  const record = {
    id: `task-${invanCaptures.length + 1}`,
    claim: claim || null,
    task: task || null,
    action: action || null,
    date: date || null,
    capturedAt: new Date().toISOString()
  };
  invanCaptures.push(record);

  // Spoken read-back for confirmation (confirm at commit).
  const bits = [];
  if (action) bits.push(action);
  if (task) bits.push(task);
  let line = bits.join(', ');
  if (claim) line += ` for ${claim}`;
  if (date) line += `, ${date}`;

  console.log(`   ✅ Captured ${record.id}`);
  return vapiResult(res, toolCallId,
    `Logged: ${line}. That's saved to the file's follow-ups. Anything else?`);
});

// ============================================
// UTILITY ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    clauses: policyDB.clauses.length,
    endorsements: endorsementDB.endorsements.length,
    policyFormChunks: documents.length,
    openClaims: invanClaims.files.length,
    adjusters: invanRoster.adjusters.length,
    capturedTasks: invanCaptures.length,
    message: 'PolicyVoice + Operations Co-Pilot backend is running'
  });
});

// ============================================
// DATA BROWSER ENDPOINTS (read-only views of what the AI sees)
// ============================================

app.get('/data/clauses', (req, res) => {
  res.json({ clauses: policyDB.clauses });
});

app.get('/data/endorsements', (req, res) => {
  res.json({ endorsements: endorsementDB.endorsements });
});

app.get('/data/policy-forms', (req, res) => {
  const grouped = {};
  for (const doc of documents) {
    if (!grouped[doc.filename]) grouped[doc.filename] = [];
    grouped[doc.filename].push({ id: doc.id, content: doc.content });
  }
  const files = Object.entries(grouped).map(([filename, chunks]) => ({ filename, chunks }));
  res.json({ files, totalChunks: documents.length });
});

app.get('/data/claims', (req, res) => {
  res.json({ files: invanClaims.files });
});

app.get('/data/roster', (req, res) => {
  res.json({ adjusters: invanRoster.adjusters });
});

app.get('/data/tasks', (req, res) => {
  res.json({ tasks: invanCaptures });
});

app.post('/reload', (req, res) => {
  policyDB = loadPolicyDB();
  endorsementDB = loadEndorsementDB();
  loadDocuments();
  invanClaims = loadInvanClaims();
  invanRoster = loadInvanRoster();
  res.json({
    success: true,
    clauses: policyDB.clauses.length,
    endorsements: endorsementDB.endorsements.length,
    policyFormChunks: documents.length,
    openClaims: invanClaims.files.length,
    adjusters: invanRoster.adjusters.length,
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
  console.log('\n🚀 PolicyVoice - Backend');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Server URL: http://localhost:${port}`);
  console.log('');
  console.log('📋 PolicyVoice endpoints:');
  console.log('  📖 POST /lookup-coverage    - Policy coverage clause (verbatim)');
  console.log('  📎 POST /lookup-endorsement - Endorsement / add-on (verbatim)');
  console.log('  📚 POST /search-policy      - Policy form document search');
  console.log('📋 Operations Co-Pilot endpoints:');
  console.log('  📋 POST /briefing          - Claim file briefing');
  console.log('  👥 POST /roster-check      - Adjuster roster / availability');
  console.log('  📝 POST /capture-task      - Capture follow-up / task');
  console.log('  💚 GET  /health            - Health check');
  console.log('  🔄 POST /reload            - Reload data');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('📊 Data Loaded:');
  console.log(`  Clauses: ${policyDB.clauses.length} · Endorsements: ${endorsementDB.endorsements.length} · Policy form chunks: ${documents.length}`);
  console.log(`  Open claims: ${invanClaims.files.length} · Adjusters: ${invanRoster.adjusters.length}`);
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
