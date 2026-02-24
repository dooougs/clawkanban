import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';

const PRIORITIES = ['Low', 'Medium', 'High'];

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const STATE_LABELS = { toDo: 'To Do', inProgress: 'In Progress', done: 'Done' };

const Kanban = () => {
  const [tasks, setTasks] = useState([]);
  const [columns, setColumns] = useState({ toDo: [], inProgress: [], done: [] });
  const [showNew, setShowNew] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', priority: 'Medium', description: '' });
  const [expandedTask, setExpandedTask] = useState(null);
  const [connected, setConnected] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState('clawkanban');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [archiveFrom, setArchiveFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return toDateStr(d); });
  const [archiveTo, setArchiveTo] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return toDateStr(d); });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Cost data is now stored directly on task.cost in JSON files

  const applyTasks = useCallback((data) => {
    setTasks(data);
    const toDo = data.filter(task => task.state === 'toDo');
    const inProgress = data.filter(task => task.state === 'inProgress');
    const done = data.filter(task => task.state === 'done');
    setColumns({ toDo, inProgress, done });
  }, []);

  // Cost statistics for classification
  const costStats = useMemo(() => {
    const costs = tasks.filter(t => t.cost && t.cost.usd > 0).map(t => t.cost.usd);
    if (costs.length === 0) return null;
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    const stddev = Math.sqrt(costs.reduce((a, b) => a + (b - mean) ** 2, 0) / costs.length);
    return { mean, stddev };
  }, [tasks]);

  const getCostTier = useCallback((usd) => {
    if (!costStats) return 'low';
    const { mean, stddev } = costStats;
    if (usd >= mean + 2 * stddev) return 'extreme';
    if (usd >= mean + stddev) return 'high';
    if (usd >= mean) return 'moderate';
    return 'low';
  }, [costStats]);

  const costTierConfig = {
    low:      { icon: '💲', cls: 'cost-tier-low' },
    moderate: { icon: '💰', cls: 'cost-tier-moderate' },
    high:     { icon: '💰💰', cls: 'cost-tier-high' },
    extreme:  { icon: '💰💰💰', cls: 'cost-tier-extreme' },
  };

  const sumCost = (arr) => arr.reduce((s, t) => s + ((t.cost && t.cost.usd) || 0), 0);

  const doneTodayTasks = useMemo(() => columns.done.filter(t => isToday(t.updatedAt)), [columns.done]);

  const archiveTasks = useMemo(() => {
    const from = new Date(archiveFrom + 'T00:00:00');
    const to = new Date(archiveTo + 'T23:59:59.999');
    return columns.done.filter(t => {
      if (isToday(t.updatedAt)) return false;
      if (!t.updatedAt) return true;
      const d = new Date(t.updatedAt);
      return d >= from && d <= to;
    });
  }, [columns.done, archiveFrom, archiveTo]);

  const archiveGrouped = useMemo(() => {
    const groups = {};
    archiveTasks.forEach(t => {
      const key = t.updatedAt ? toDateStr(new Date(t.updatedAt)) : 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [archiveTasks]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return tasks.filter(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.id || '').toLowerCase().includes(q) ||
      (t.identifier || '').toLowerCase().includes(q)
    );
  }, [tasks, searchQuery]);

  const load = useCallback(() => {
    fetch(`/api/projects/${currentProject}/tasks`)
      .then(response => response.json())
      .then(applyTasks);
  }, [currentProject, applyTasks]);

  const loadProjects = () => {
    fetch('/api/projects').then(r => r.json()).then(setProjects);
  };

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { load(); }, [refreshKey, currentProject, load]);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    let reconnectTimer;
    function connect() {
      ws = new WebSocket(`${proto}//${window.location.host}`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === 'init') {
            if (msg.data.projects) setProjects(msg.data.projects);
            if (msg.data.tasks) applyTasks(msg.data.tasks);
          } else {
            setRefreshKey(k => k + 1);
          }
        } catch (err) {}
      };
      ws.onclose = () => { setConnected(false); reconnectTimer = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => { clearTimeout(reconnectTimer); if (ws) ws.close(); };
  }, [applyTasks]);

  const handleDragStart = (event, task) => { event.dataTransfer.setData('taskId', task.id); };

  const handleDrop = (event, newState) => {
    const taskId = event.dataTransfer.getData('taskId');
    fetch(`/api/projects/${currentProject}/tasks/${taskId}/state`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: newState })
    }).then(() => load());
  };

  const createTask = (e) => {
    e.preventDefault();
    fetch(`/api/projects/${currentProject}/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTask)
    }).then(() => { setNewTask({ title: '', priority: 'Medium', description: '' }); setShowNew(false); load(); });
  };

  const createProject = (e) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newProjectName.trim() })
    }).then(r => r.json()).then((p) => {
      setNewProjectName(''); setShowNewProject(false); loadProjects(); setCurrentProject(p.name);
    });
  };

  const addComment = (taskId, text) => {
    if (!text) return;
    fetch(`/api/projects/${currentProject}/tasks/${taskId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    }).then(() => load());
  };

  const changePriority = (taskId, priority) => {
    fetch(`/api/projects/${currentProject}/tasks/${taskId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority })
    }).then(() => load());
  };

  const renderTask = (task) => {
    const isExpanded = expandedTask === task.id;
    return (
      <div
        key={task.id}
        className="task"
        draggable={!isExpanded}
        onDragStart={(e) => {
          if (isExpanded) { e.preventDefault(); return; }
          handleDragStart(e, task);
        }}
        onClick={(e) => {
          const tag = e.target.tagName.toLowerCase();
          if (['input', 'textarea', 'select', 'button', 'a', 'label'].includes(tag)) return;
          if (window.getSelection && window.getSelection().toString()) return;
          setExpandedTask(isExpanded ? null : task.id);
        }}
      >
        <div className="task-title">{task.title}</div>
        {task.identifier && <div className="task-identifier">{task.identifier}</div>}
        <div className="task-meta">
          Priority: {task.priority} &bull; Comments: {(task.comments||[]).length}
          {task.cost && task.cost.usd > 0 && (() => {
            const tier = getCostTier(task.cost.usd);
            const cfg = costTierConfig[tier];
            return (
              <span className={`cost-badge ${cfg.cls}`} title={`${cfg.icon} ${tier} · ${task.cost.messages || 0} msg · ${Math.round((task.cost.inputTokens + task.cost.outputTokens)/1000)}k tokens`}>
                {cfg.icon} ${task.cost.usd < 0.01 ? '<0.01' : task.cost.usd.toFixed(2)}
              </span>
            );
          })()}
        </div>
        {isExpanded && (
          <div className="task-details" onClick={(e) => e.stopPropagation()}>
            <div className="task-desc" style={{whiteSpace:'pre-wrap',wordWrap:'break-word'}}>{task.description}</div>
            <div className="task-actions">
              <label>Priority: </label>
              <select value={task.priority} onChange={(e) => { e.stopPropagation(); changePriority(task.id, e.target.value); }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="task-comments">
              <h4>Comments</h4>
              {(task.comments||[]).map(c => (
                <div key={c.id} className="comment">{c.text} <small>&mdash; {c.author}</small></div>
              ))}
              <form onSubmit={(e) => {
                e.preventDefault(); e.stopPropagation();
                const val = e.target.elements.comment.value;
                if (val.trim()) { addComment(task.id, val); e.target.reset(); }
              }}>
                <input name="comment" placeholder="Add comment"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                />
                <button type="submit" onClick={(e) => e.stopPropagation()}>Add</button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderInlineNewTask = () => (
    <div className="inline-new-task">
      {!showNew ? (
        <button className="add-task-btn" onClick={() => setShowNew(true)}>+ Add Task</button>
      ) : (
        <form className="inline-new-task-form" onSubmit={createTask}>
          <input required autoFocus placeholder="Task title" value={newTask.title}
            onChange={(e) => setNewTask({...newTask, title: e.target.value})} />
          <textarea rows={5} placeholder="Description (optional)" value={newTask.description}
            onChange={(e) => setNewTask({...newTask, description: e.target.value})}
            style={{resize:'vertical',wordWrap:'break-word'}} />
          <div className="inline-new-task-actions">
            <select value={newTask.priority} onChange={(e) => setNewTask({...newTask, priority: e.target.value})}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="submit">Create</button>
            <button type="button" onClick={() => { setShowNew(false); setNewTask({ title: '', priority: 'Medium', description: '' }); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );

  const renderColumn = (state) => (
    <div className="column" onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, state)}>
      <h2>{state}</h2>
      {columns[state].map(renderTask)}
      {state === 'toDo' && renderInlineNewTask()}
    </div>
  );

  return (
    <div>
      <div className="kanban-header">
        <div style={{display:'flex',alignItems:'center',gap:'20px'}}>
          <div className="brand"><span className="claw-icon">🐾</span> ClawKanban</div>
          <div className="project-switcher">
            <select value={currentProject} onChange={(e) => setCurrentProject(e.target.value)}>
              {projects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {!showNewProject ? (
              <button className="new-project-btn" onClick={() => setShowNewProject(true)}>+ Project</button>
            ) : (
              <form onSubmit={createProject} style={{display:'inline'}}>
                <input autoFocus placeholder="Project name" value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)} />
                <button type="submit">Create</button>
                <button type="button" onClick={() => setShowNewProject(false)}>&#10005;</button>
              </form>
            )}
          </div>
          <button className="search-toggle-btn" onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(''); }}>
            &#128269; Search
          </button>
        </div>
        <div>
          <span className={`connection-led ${connected ? 'connected' : 'disconnected'}`} />
          <span className="connection-label">{connected ? 'Live' : 'Offline'}</span>
        </div>
      </div>

      {searchOpen && (
        <div className="search-panel">
          <div className="search-bar">
            <input autoFocus placeholder="Search tasks by title, description, or ID&hellip;"
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="search-input" />
            <button className="search-close-btn" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}>&#10005;</button>
          </div>
          {searchQuery.trim() && (
            <div className="search-results">
              {searchResults.length === 0 && <div className="search-empty">No tasks found</div>}
              {searchResults.map(t => (
                <div key={t.id} className="search-result-item" onClick={() => { setExpandedTask(t.id); setSearchOpen(false); setSearchQuery(''); }}>
                  <div className="search-result-title">{t.title}</div>
                  <div className="search-result-meta">
                    <span className={'search-state search-state-' + t.state}>{STATE_LABELS[t.state] || t.state}</span>
                    {' \u2022 '}{t.priority}{' \u2022 '}<span className="search-result-id">{t.id}</span>
                  </div>
                  {t.description && <div className="search-result-desc">{t.description.slice(0, 120)}{t.description.length > 120 ? '...' : ''}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="kanban-board">
        {renderColumn('toDo')}
        {renderColumn('inProgress')}

        {/* Done Today column */}
        <div className="column" onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, 'done')}>
          <h2>done today</h2>
          {doneTodayTasks.length > 0 && <div className="column-cost-total">💲 Today: ${sumCost(doneTodayTasks).toFixed(2)}</div>}
          {doneTodayTasks.map(renderTask)}
        </div>

        {/* Archive column */}
        <div className="column archive-column">
          <h2>archive</h2>
          <div className="archive-date-range" onClick={(e) => e.stopPropagation()}>
            <input type="date" value={archiveFrom} onChange={(e) => setArchiveFrom(e.target.value)} />
            <span className="archive-date-sep">to</span>
            <input type="date" value={archiveTo} onChange={(e) => setArchiveTo(e.target.value)} />
          </div>
          {archiveTasks.length > 0 && <div className="column-cost-total">💲 Total: ${sumCost(archiveTasks).toFixed(2)}</div>}
          {archiveTasks.length === 0 && <div className="archive-empty">No archived tasks in this range</div>}
          {archiveGrouped.map(([date, tasks]) => (
            <div key={date} className="archive-day-group">
              <div className="archive-day-header">
                <span className="archive-day-date">{date === 'unknown' ? 'Unknown date' : new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="archive-day-cost">${sumCost(tasks).toFixed(2)}</span>
              </div>
              {tasks.map(renderTask)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Kanban;