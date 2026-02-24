const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const { randomBytes } = require('crypto');
const { generateIdentifier } = require('./identifier-words');
const app = express();
const server = http.createServer(app);

const DATA_FOLDER = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_FOLDER)) {
  fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

app.use(express.json());

// Serve the static files from the React app
app.use(express.static(path.join(__dirname, 'react-ui', 'build')));

// Helper: get project data dir
function projectDir(project) {
  // Sanitize project name
  const safe = project.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(DATA_FOLDER, safe);
}

// Helper to read all task files for a project
function readAllTasks(project) {
  const dir = projectDir(project);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, f)));
      t.project = project;
      return t;
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

// Helper to read all tasks across all projects
function readAllTasksAllProjects() {
  const projects = listProjects();
  const all = [];
  for (const p of projects) {
    all.push(...readAllTasks(p));
  }
  return all;
}

// Collect all identifiers across all projects
function getAllIdentifiers() {
  const ids = new Set();
  const projects = listProjects();
  for (const p of projects) {
    for (const t of readAllTasks(p)) {
      if (t.identifier) ids.add(t.identifier);
    }
  }
  return ids;
}

// Backfill tasks missing identifiers
function backfillIdentifiers() {
  const existing = getAllIdentifiers();
  for (const p of listProjects()) {
    const dir = projectDir(p);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const fp = path.join(dir, f);
      try {
        const t = JSON.parse(fs.readFileSync(fp));
        if (!t.identifier) {
          t.identifier = generateIdentifier(existing);
          existing.add(t.identifier);
          fs.writeFileSync(fp, JSON.stringify(t, null, 2));
        }
      } catch (e) {}
    }
  }
}

// List projects
function listProjects() {
  return fs.readdirSync(DATA_FOLDER).filter(f => {
    return fs.statSync(path.join(DATA_FOLDER, f)).isDirectory();
  });
}

// --- Project routes ---
app.get('/api/projects', (req, res) => {
  res.json(listProjects());
});

app.post('/api/projects', (req, res) => {
  const name = (req.body.name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!name) return res.status(400).json({ error: 'Invalid project name' });
  const dir = projectDir(name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  res.status(201).json({ name });
});

// --- Project-scoped task routes ---
app.get('/api/projects/:project/tasks', (req, res) => {
  res.json(readAllTasks(req.params.project));
});

app.get('/api/projects/:project/tasks/:id', (req, res) => {
  const file = path.join(projectDir(req.params.project), `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  const t = JSON.parse(fs.readFileSync(file));
  t.project = req.params.project;
  res.json(t);
});

app.post('/api/projects/:project/tasks', (req, res) => {
  const dir = projectDir(req.params.project);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const body = req.body || {};
  const id = body.id || randomBytes(6).toString('hex');
  const identifier = body.identifier || generateIdentifier(getAllIdentifiers());
  const task = Object.assign({
    id,
    identifier,
    title: body.title || 'Untitled',
    description: body.description || '',
    priority: body.priority || 'Medium',
    owner: body.owner || '',
    state: body.state || 'toDo',
    comments: body.comments || [],
    createdAt: new Date().toISOString()
  }, body, { identifier, project: req.params.project });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(task, null, 2));
  broadcast('taskCreated', task);
  res.status(201).json(task);
});

app.put('/api/projects/:project/tasks/:id', (req, res) => {
  const file = path.join(projectDir(req.params.project), `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  const existing = JSON.parse(fs.readFileSync(file));
  const updated = Object.assign({}, existing, req.body, { project: req.params.project, updatedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(updated, null, 2));
  broadcast('taskUpdated', updated);
  res.json(updated);
});

app.put('/api/projects/:project/tasks/:id/state', (req, res) => {
  const file = path.join(projectDir(req.params.project), `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  const existing = JSON.parse(fs.readFileSync(file));
  existing.state = req.body.state || existing.state;
  existing.project = req.params.project;
  existing.updatedAt = new Date().toISOString();
  // Auto-calculate cost when moving to done
  if (existing.state === 'done' && !existing.cost) {
    existing.cost = calculateTaskCost(existing);
  }
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  broadcast('taskUpdated', existing);
  res.json(existing);
});

app.post('/api/projects/:project/tasks/:id/comments', (req, res) => {
  const file = path.join(projectDir(req.params.project), `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  const existing = JSON.parse(fs.readFileSync(file));
  const comment = {
    id: randomBytes(6).toString('hex'),
    author: req.body.author || 'anonymous',
    text: req.body.text || '',
    createdAt: new Date().toISOString()
  };
  existing.comments = existing.comments || [];
  existing.comments.push(comment);
  existing.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  broadcast('taskUpdated', existing);
  res.status(201).json(comment);
});

// --- Backward-compat: /api/tasks routes redirect to default project "clawkanban" ---
app.get('/api/tasks', (req, res) => {
  res.json(readAllTasksAllProjects());
});

app.get('/api/tasks/:id', (req, res) => {
  // Search across all projects
  for (const p of listProjects()) {
    const file = path.join(projectDir(p), `${req.params.id}.json`);
    if (fs.existsSync(file)) {
      const t = JSON.parse(fs.readFileSync(file));
      t.project = p;
      return res.json(t);
    }
  }
  res.sendStatus(404);
});

app.post('/api/tasks', (req, res) => {
  req.params.project = 'clawkanban';
  const dir = projectDir('clawkanban');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const body = req.body || {};
  const id = body.id || randomBytes(6).toString('hex');
  const identifier = body.identifier || generateIdentifier(getAllIdentifiers());
  const task = Object.assign({
    id,
    identifier,
    title: body.title || 'Untitled',
    description: body.description || '',
    priority: body.priority || 'Medium',
    owner: body.owner || '',
    state: body.state || 'toDo',
    comments: body.comments || [],
    createdAt: new Date().toISOString()
  }, body, { identifier, project: 'clawkanban' });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(task, null, 2));
  broadcast('taskCreated', task);
  res.status(201).json(task);
});

// --- Cost tracking: scan session transcripts for task-related token usage ---
const SESSIONS_DIR = path.join(require('os').homedir(), '.openclaw', 'agents', 'main', 'sessions');

// Pricing per million tokens (USD)
const MODEL_PRICING = {
  'claude-opus-4-6':     { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6':   { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-opus-20240229': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'gpt-4o':              { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  'gpt-5.2':             { input: 5, output: 20, cacheRead: 2.5, cacheWrite: 5 },
};
const DEFAULT_PRICING = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

function calcCostForTokens(model, usage) {
  const p = MODEL_PRICING[model] || DEFAULT_PRICING;
  return (
    (usage.input || 0) * p.input / 1e6 +
    (usage.output || 0) * p.output / 1e6 +
    (usage.cacheRead || 0) * p.cacheRead / 1e6 +
    (usage.cacheWrite || 0) * p.cacheWrite / 1e6
  );
}

// Calculate cost for a single task using time-window matching across all session transcripts
function calculateTaskCost(task) {
  if (!fs.existsSync(SESSIONS_DIR)) return null;

  const comments = task.comments || [];
  const firstComment = comments[0];
  const lastComment = comments[comments.length - 1];
  const start = new Date(firstComment?.at || task.createdAt).getTime();
  const end = new Date(lastComment?.at || task.updatedAt).getTime();
  const buffer = 60000; // 1min buffer

  let totalCost = 0, totalInput = 0, totalOutput = 0, msgCount = 0;

  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    try {
      const lines = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message' && obj.message?.usage && obj.message?.role === 'assistant') {
            const ts = obj.message.timestamp;
            if (ts >= start - 5000 && ts <= end + buffer) {
              const u = obj.message.usage;
              totalCost += calcCostForTokens(obj.message.model || '', u);
              totalInput += (u.input || 0) + (u.cacheRead || 0);
              totalOutput += u.output || 0;
              msgCount++;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  return { usd: Math.round(totalCost * 100) / 100, inputTokens: totalInput, outputTokens: totalOutput, messages: msgCount };
}

// Auto-calculate cost when a task moves to "done"
function maybeUpdateCost(taskFile) {
  try {
    const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    if (task.state === 'done' && !task.cost) {
      task.cost = calculateTaskCost(task);
      task.updatedAt = new Date().toISOString();
      fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
      broadcast('taskUpdated', task);
    }
  } catch (e) {}
}

// Cache to avoid re-scanning unchanged files
const costCache = { ts: 0, data: {} };
const COST_CACHE_TTL = 30000; // 30s

function scanSessionCosts() {
  const now = Date.now();
  if (now - costCache.ts < COST_CACHE_TTL && Object.keys(costCache.data).length > 0) {
    return costCache.data;
  }

  const taskCosts = {}; // taskId -> { cost, inputTokens, outputTokens, sessions }

  if (!fs.existsSync(SESSIONS_DIR)) return taskCosts;

  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8');

      // Find all task IDs mentioned via "task id: XXXX" pattern
      const taskIdMatches = content.match(/task id: ([0-9a-f]{12})/g);
      if (!taskIdMatches) continue;

      const taskIds = [...new Set(taskIdMatches.map(m => m.replace('task id: ', '')))];

      // Sum up token usage for this session
      let totalCost = 0;
      let totalInput = 0;
      let totalOutput = 0;
      const lines = content.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message' && obj.message?.usage) {
            const u = obj.message.usage;
            const model = obj.message.model || '';
            totalCost += calcCostForTokens(model, u);
            totalInput += (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
            totalOutput += u.output || 0;
          }
        } catch (e) {}
      }

      // If multiple tasks in one session, split evenly
      const perTask = totalCost / taskIds.length;
      const perTaskInput = Math.round(totalInput / taskIds.length);
      const perTaskOutput = Math.round(totalOutput / taskIds.length);

      for (const tid of taskIds) {
        if (!taskCosts[tid]) taskCosts[tid] = { cost: 0, inputTokens: 0, outputTokens: 0, sessions: 0 };
        taskCosts[tid].cost += perTask;
        taskCosts[tid].inputTokens += perTaskInput;
        taskCosts[tid].outputTokens += perTaskOutput;
        taskCosts[tid].sessions += 1;
      }
    } catch (e) {}
  }

  costCache.ts = now;
  costCache.data = taskCosts;
  return taskCosts;
}

app.get('/api/task-costs', (req, res) => {
  res.json(scanSessionCosts());
});

app.get('/api/task-costs/:taskId', (req, res) => {
  const costs = scanSessionCosts();
  res.json(costs[req.params.taskId] || { cost: 0, inputTokens: 0, outputTokens: 0, sessions: 0 });
});

// Catch-all for SPA
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'react-ui', 'build', 'index.html'));
});

// WebSocket server
const wss = new WebSocketServer({ server });

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  // Send projects and tasks for default project on connect
  ws.send(JSON.stringify({ event: 'init', data: { projects: listProjects(), tasks: readAllTasks('clawkanban') } }));
});

// Watch data directory for external file changes (e.g. agent direct file I/O)
// and broadcast updates so the UI stays in sync.
function watchDataDir() {
  const debounceTimers = {};

  function watchProject(project) {
    const dir = projectDir(project);
    try {
      fs.watch(dir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.json')) return;
        // Debounce: coalesce rapid writes into one broadcast
        const key = `${project}/${filename}`;
        if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
        debounceTimers[key] = setTimeout(() => {
          delete debounceTimers[key];
          const file = path.join(dir, filename);
          try {
            if (fs.existsSync(file)) {
              const task = JSON.parse(fs.readFileSync(file, 'utf8'));
              task.project = project;
              // Auto-calculate cost when task is marked done via direct file I/O
              if (task.state === 'done' && !task.cost) {
                task.cost = calculateTaskCost(task);
                fs.writeFileSync(file, JSON.stringify(task, null, 2));
              }
              broadcast('taskUpdated', task);
            }
          } catch (e) { /* ignore parse errors from partial writes */ }
        }, 300);
      });
    } catch (e) {
      console.error(`Failed to watch ${dir}:`, e.message);
    }
  }

  // Watch for new project directories
  fs.watch(DATA_FOLDER, (eventType, filename) => {
    if (!filename) return;
    const full = path.join(DATA_FOLDER, filename);
    try {
      if (fs.statSync(full).isDirectory()) {
        watchProject(filename);
      }
    } catch (e) {}
  });

  // Watch existing projects
  listProjects().forEach(watchProject);
}

watchDataDir();

// Backfill identifiers on startup
backfillIdentifiers();

const port = process.env.PORT || 8008;
server.listen(port);

console.log('Kanban app is running on port ' + port);
