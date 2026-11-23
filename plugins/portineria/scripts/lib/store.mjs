// Dati persistenti del plugin: statistiche dei risparmi e progetti in pausa.
// Vivono nella cartella dati del plugin (CLAUDE_PLUGIN_DATA), mai nel progetto.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function dataDir() {
  return process.env.PORTINERIA_DATA_DIR || process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'portineria');
}

function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir(), file), 'utf8')); } catch { return fallback; }
}

function save(file, obj) {
  try {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${file}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, path.join(dir, file));
  } catch { /* i dati sono un extra: se non si salvano, si va avanti */ }
}

const projectKey = (dir) => path.resolve(dir).toLowerCase();

export function isPaused(projectDir) {
  const s = load('settings.json', {});
  return Array.isArray(s.paused) && s.paused.includes(projectKey(projectDir));
}

export function setPaused(projectDir, paused) {
  const s = load('settings.json', {});
  const list = new Set(Array.isArray(s.paused) ? s.paused : []);
  if (paused) list.add(projectKey(projectDir)); else list.delete(projectKey(projectDir));
  s.paused = [...list];
  save('settings.json', s);
}

const emptyStats = () => ({ version: 1, total: { answers: 0, saved: 0, quick: 0 }, byIntent: {}, sessions: {} });

export function readStats() {
  const s = load('stats.json', null);
  return s && s.version === 1 ? s : emptyStats();
}

export function recordAnswer({ sessionId, intent, saved, quick = false }) {
  const s = readStats();
  const add = Math.max(0, Math.round(saved || 0));
  s.total.answers += 1;
  s.total.saved += add;
  if (quick) s.total.quick += 1;
  s.byIntent[intent] = (s.byIntent[intent] || 0) + 1;
  const key = sessionId || 'sconosciuta';
  const sess = s.sessions[key] || { answers: 0, saved: 0, last: 0 };
  sess.answers += 1;
  sess.saved += add;
  sess.last = Date.now();
  s.sessions[key] = sess;
  const keys = Object.keys(s.sessions).sort((a, b) => s.sessions[b].last - s.sessions[a].last);
  for (const k of keys.slice(40)) delete s.sessions[k];
  save('stats.json', s);
  return s;
}
