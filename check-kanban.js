const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_SCRIPT = path.join(__dirname, 'server.js');
const HEARTBEAT_FILE = path.join(__dirname, '..', 'HEARTBEAT.md');
const DATA_FOLDER = path.join(__dirname, 'data');
const OUT_LOG = path.join(__dirname, 'server.out.log');
const ERR_LOG = path.join(__dirname, 'server.err.log');
const PID_FILE = path.join(__dirname, 'server.pid');

function startServer() {
  try {
    const outFd = fs.openSync(OUT_LOG, 'a');
    const errFd = fs.openSync(ERR_LOG, 'a');
    const env = Object.assign({}, process.env);
    // Ensure vendored modules from the image are available to the spawned server.
    if (!env.NODE_PATH) env.NODE_PATH = '/opt/prod_node_modules/node_modules:/usr/local/lib/node_modules';
    else if (env.NODE_PATH.indexOf('/opt/prod_node_modules/node_modules') === -1) {
      env.NODE_PATH = '/opt/prod_node_modules/node_modules:' + env.NODE_PATH;
    }

    const child = spawn('node', [SERVER_SCRIPT], {
      detached: true,
      stdio: ['ignore', outFd, errFd],
      cwd: __dirname,
      env
    });
    child.unref();
    try { fs.writeFileSync(PID_FILE, String(child.pid)); } catch (e) {}
    console.log(`Kanban server started (pid ${child.pid}), stdout->${OUT_LOG}, stderr->${ERR_LOG}`);
  } catch (e) {
    console.error('Failed to start Kanban server:', e && e.message);
  }
}

function checkToDoTasks() {
  // Check for toDo tasks across all project subdirectories
  try {
    const todoTasks = [];
    const entries = fs.readdirSync(DATA_FOLDER);
    for (const entry of entries) {
      const entryPath = path.join(DATA_FOLDER, entry);
      try {
        if (fs.statSync(entryPath).isDirectory()) {
          const files = fs.readdirSync(entryPath).filter(f => f.endsWith('.json'));
          for (const f of files) {
            try {
              const task = JSON.parse(fs.readFileSync(path.join(entryPath, f), 'utf8'));
              if (task.state === 'toDo') todoTasks.push(task.title);
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
    return todoTasks;
  } catch (e) {
    return [];
  }
}

function updateHeartbeat(todoTasks) {
  if (todoTasks.length > 0) {
    const content = `# HEARTBEAT.md\nrun workflow\n`;
    fs.writeFileSync(HEARTBEAT_FILE, content);
    console.log(`HEARTBEAT.md updated: ${todoTasks.length} toDo task(s) found`);
  } else {
    const content = `# HEARTBEAT.md\n# No tasks in toDo — LLM heartbeat skipped\n`;
    fs.writeFileSync(HEARTBEAT_FILE, content);
    console.log('HEARTBEAT.md cleared: no toDo tasks');
  }
}

// Check for toDo tasks and update heartbeat (works even if server is down)
const todoTasks = checkToDoTasks();
updateHeartbeat(todoTasks);

// Ensure server is running
const req = http.request(
  { hostname: 'localhost', port: 8008, path: '/api/tasks', method: 'GET' },
  (res) => {
    if (res.statusCode === 200) {
      res.resume();
      console.log('Kanban server is already running.');
    } else {
      res.resume();
      console.log('Kanban server returned non-200. Restarting...');
      startServer();
    }
  }
);

req.on('error', () => {
  console.error('Kanban server not reachable. Starting...');
  startServer();
});

req.end();
