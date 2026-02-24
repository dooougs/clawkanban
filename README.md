# 🐾 ClawKanban

A lightweight, file-backed Kanban board designed for use alongside AI coding agents. Tasks are stored as plain JSON files on disk, making them readable and writable by both the web UI and AI agents directly. Real-time synchronization between all connected clients is provided via WebSockets.

<img width="2229" height="1149" alt="Screenshot 2026-02-24 163553" src="https://github.com/user-attachments/assets/20bf7e4e-aa91-403c-8e9c-d16f54b00e23" />

---

## Features

- **Multi-project support** — create and switch between independent project boards.
- **Kanban columns** — *To Do*, *In Progress*, *Done Today*, and an *Archive* with date-range filtering.
- **Drag-and-drop** task movement between columns.
- **Human-readable task identifiers** — every task gets a unique `ColourAnimalCity` identifier (e.g. `TealOtterPrague`) for easy reference in conversation.
- **Comments** — threaded per-task comment threads.
- **Priority levels** — Low, Medium, High, changeable inline.
- **AI cost tracking** — when a task moves to *Done*, token usage from OpenClaw agent sessions is matched by time window and stored on the task. Cost badges (💲 / 💰 / 💰💰 / 💰💰💰) reflect spend relative to the project average.
- **Real-time UI updates** — file-system watcher + WebSocket broadcasts keep every browser tab in sync, including changes made by agents writing JSON directly to disk.
- **Search** — full-text search across title, description, and IDs.
- **Heartbeat helper** — `check-kanban.js` auto-starts the server and writes a `HEARTBEAT.md` file that external schedulers can use to trigger agent runs when *To Do* tasks are waiting.

---

## Project Structure

```
clawkanban/
├── server.js             # Express + WebSocket backend
├── check-kanban.js       # Health-check / heartbeat helper
├── identifier-words.js   # Word lists for human-readable identifiers
├── package.json          # Backend dependencies
├── data/                 # Runtime data – one sub-directory per project
│   └── <project>/
│       └── <taskId>.json
└── react-ui/             # Create React App frontend
    ├── public/
    └── src/
        ├── App.js
        └── Kanban.js     # Main board component
```

---

## Getting Started

### Prerequisites

- **Node.js** 18 or later
- **npm**

### Install dependencies

```bash
# Backend
npm install

# Frontend
cd react-ui && npm install
```

### Build the React UI

```bash
cd react-ui && npm run build
```

The production build is placed in `react-ui/build/` and served automatically by the backend.

### Start the server

```bash
node server.js
```

The server listens on **port 8008** by default (override with the `PORT` environment variable).

Open [http://localhost:8008](http://localhost:8008) in your browser.

### Development mode (hot-reload UI)

```bash
# Terminal 1 – backend
node server.js

# Terminal 2 – React dev server (proxied to backend)
cd react-ui && npm start
```

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `8008` | Port the HTTP/WebSocket server listens on |

Task data is persisted to a `data/` directory created automatically next to `server.js`. Each project gets its own sub-directory; each task is a single `.json` file named by the task's hex `id`.

---

## REST API

All endpoints return / accept `application/json`.

### Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create a project — body: `{ "name": "my-project" }` |

### Tasks

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects/:project/tasks` | List all tasks in a project |
| `GET` | `/api/projects/:project/tasks/:id` | Get a single task |
| `POST` | `/api/projects/:project/tasks` | Create a task |
| `PUT` | `/api/projects/:project/tasks/:id` | Update a task (full merge) |
| `PUT` | `/api/projects/:project/tasks/:id/state` | Update task state only — body: `{ "state": "inProgress" }` |
| `POST` | `/api/projects/:project/tasks/:id/comments` | Add a comment — body: `{ "text": "…", "author": "…" }` |

#### Task states

| Value | Label |
|---|---|
| `toDo` | To Do |
| `inProgress` | In Progress |
| `done` | Done |

#### Task schema

```json
{
  "id": "a1b2c3d4e5f6",
  "identifier": "TealOtterPrague",
  "title": "Implement login page",
  "description": "…",
  "priority": "Medium",
  "owner": "",
  "state": "toDo",
  "comments": [
    { "id": "…", "author": "alice", "text": "…", "createdAt": "…" }
  ],
  "cost": {
    "usd": 0.12,
    "inputTokens": 42000,
    "outputTokens": 3200,
    "messages": 14
  },
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-02T00:00:00.000Z",
  "project": "clawkanban"
}
```

### Cost endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/task-costs` | Return cost map for all tasks (keyed by task `id`) |
| `GET` | `/api/task-costs/:taskId` | Return cost summary for a single task |

### Legacy (backward-compatible)

`/api/tasks` and `/api/tasks/:id` are retained for compatibility. `GET /api/tasks` returns tasks across **all** projects; `POST /api/tasks` creates in the built-in `clawkanban` project.

---

## WebSocket Events

Connect to `ws://localhost:8008`. On connection the server sends an `init` event:

```json
{ "event": "init", "data": { "projects": ["clawkanban"], "tasks": [ … ] } }
```

Subsequent events broadcast to all clients whenever a task changes:

| Event | Payload |
|---|---|
| `taskCreated` | Full task object |
| `taskUpdated` | Full updated task object |

---

## check-kanban.js

This helper script is intended to be run on a schedule (e.g. a cron job or CI workflow trigger):

```bash
node check-kanban.js
```

It performs two actions:

1. **Heartbeat** — scans `data/` for tasks in the `toDo` state and writes `HEARTBEAT.md` one directory above the project root. If *To Do* tasks exist, the file contains `run workflow`; otherwise it notes that the heartbeat is skipped. An external scheduler can poll this file to decide whether to wake up an AI agent.
2. **Server health-check** — pings `GET /api/tasks`. If the server is not reachable it spawns `server.js` as a detached background process, logging stdout/stderr to `server.out.log` / `server.err.log` and writing the PID to `server.pid`.

---

## AI Agent Integration

ClawKanban is built to work alongside AI coding agents (such as [OpenClaw](https://github.com/dooougs/openclaw)):

- Agents create or update tasks by writing JSON files directly to `data/<project>/<id>.json`. The file-system watcher in `server.js` detects these writes and broadcasts updates to the UI in real time.
- When a task transitions to `done` (either via the API or direct file write), the server attempts to calculate the total LLM cost for that task by scanning JSONL session transcripts in `~/.openclaw/agents/main/sessions/` and matching assistant messages within the task's active time window.
- Task identifiers (`ColourAnimalCity`) provide a stable, human-friendly reference that agents can include in session logs for cost attribution.

---

## Running Tests

```bash
# React unit tests
cd react-ui && npm test
```

---

## License

This project is licensed under the **GNU General Public License v2.0**. See [LICENSE](LICENSE) for details.
