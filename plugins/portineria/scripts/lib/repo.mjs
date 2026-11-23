// Accesso al progetto: git, elenco dei file, ricerca nel codice.
// Tutto locale, nessuna rete. Se git non c'è si ripiega su una scansione delle cartelle.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage',
  'vendor', 'target', '__pycache__', '.venv', 'venv', 'env', '.tox', '.cache', '.turbo',
  '.parcel-cache', '.idea', '.vscode', '.gradle', 'Pods', 'DerivedData', '.godot', '.import',
]);
const SKIP_FILES = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$|\.(?:min\.js|min\.css|map|lock|svg|png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp[34]|wav|ogg|exe|dll|so|dylib|bin|wasm)$/i;

const GIT_EXCLUDES = [
  ...[...SKIP_DIRS].filter((d) => d !== '.git').map((d) => `:(exclude,glob)**/${d}/**`),
  ':(exclude,glob)**/*.min.js', ':(exclude,glob)**/*.min.css', ':(exclude,glob)**/*.map',
  ':(exclude,glob)**/package-lock.json', ':(exclude,glob)**/yarn.lock', ':(exclude,glob)**/pnpm-lock.yaml',
  ':(exclude,glob)**/*.lock', ':(exclude,glob)**/*.svg',
];

const MAX_WALK_FILES = 8000;
const MAX_FILE_BYTES = 1_500_000;

export function run(cmd, args, cwd, { timeout = 4000, input } = {}) {
  try {
    const r = spawnSync(cmd, args, {
      cwd, input, timeout, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
    if (r.error || r.status === null) return { ok: false, status: -1, out: '', err: String(r.error || 'timeout') };
    return { ok: r.status === 0, status: r.status, out: r.stdout || '', err: r.stderr || '' };
  } catch (e) {
    return { ok: false, status: -1, out: '', err: String(e) };
  }
}

export function git(args, cwd, opts) {
  return run('git', ['-c', 'core.quotepath=off', '--no-pager', ...args], cwd, opts);
}

const rootCache = new Map();
export function gitRoot(cwd) {
  if (rootCache.has(cwd)) return rootCache.get(cwd);
  const r = git(['rev-parse', '--show-toplevel'], cwd, { timeout: 2000 });
  const root = r.ok ? path.resolve(r.out.trim()) : null;
  rootCache.set(cwd, root);
  return root;
}

export function projectRoot(cwd) {
  return gitRoot(cwd) || path.resolve(cwd);
}

function walk(root) {
  const files = [];
  const stack = [''];
  while (stack.length && files.length < MAX_WALK_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(p);
      } else if (e.isFile()) {
        files.push(p);
        if (files.length >= MAX_WALK_FILES) break;
      }
    }
  }
  return files.sort();
}

// Elenco dei file del progetto, con percorsi relativi alla radice.
export function listFiles(root) {
  if (gitRoot(root)) {
    const r = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root, { timeout: 5000 });
    if (r.ok) {
      const deleted = new Set(git(['ls-files', '--deleted', '-z'], root, { timeout: 5000 }).out.split('\0'));
      const seen = new Set();
      return r.out.split('\0').filter((f) => {
        if (!f || seen.has(f) || deleted.has(f)) return false;
        seen.add(f);
        return !f.split('/').some((part) => SKIP_DIRS.has(part));
      });
    }
  }
  return walk(root);
}

function isProbablyText(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

export function readText(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const buf = fs.readFileSync(file);
    return isProbablyText(buf) ? buf.toString('utf8') : null;
  } catch {
    return null;
  }
}

function parseGrep(out) {
  const hits = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const a = line.indexOf('\0');
    const b = a >= 0 ? line.indexOf('\0', a + 1) : -1;
    if (a < 0 || b < 0) continue;
    const file = line.slice(0, a);
    if (SKIP_FILES.test(file)) continue;
    hits.push({ file, line: Number(line.slice(a + 1, b)), text: line.slice(b + 1) });
  }
  return hits;
}

// Tutte le righe che contengono la parola esatta `word`.
export function grepWord(root, word, { limit = 4000 } = {}) {
  if (gitRoot(root)) {
    const r = git(['grep', '-n', '-z', '-I', '--untracked', '-w', '-F', '-e', word, '--', '.', ...GIT_EXCLUDES], root, { timeout: 8000 });
    if (r.status === 0 || r.status === 1) return parseGrep(r.out).slice(0, limit);
  }
  const re = new RegExp(`(?<![\\w$])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`);
  const hits = [];
  for (const f of walk(root)) {
    if (SKIP_FILES.test(f)) continue;
    const txt = readText(path.join(root, f));
    if (!txt || !txt.includes(word)) continue;
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ file: f, line: i + 1, text: lines[i] });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

// Righe che corrispondono a un'espressione (per TODO e FIXME).
export function grepRegex(root, gitEre, jsRe, { limit = 2000 } = {}) {
  if (gitRoot(root)) {
    const r = git(['grep', '-n', '-z', '-I', '--untracked', '-E', '-e', gitEre, '--', '.', ...GIT_EXCLUDES], root, { timeout: 8000 });
    if (r.status === 0 || r.status === 1) return parseGrep(r.out).slice(0, limit);
  }
  const hits = [];
  for (const f of walk(root)) {
    if (SKIP_FILES.test(f)) continue;
    const txt = readText(path.join(root, f));
    if (!txt) continue;
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (jsRe.test(lines[i])) {
        hits.push({ file: f, line: i + 1, text: lines[i] });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

export function isTestPath(f) {
  return /(?:^|\/)(?:tests?|__tests__|spec|specs)\/|[._-](?:test|spec)\.[a-z]+$|^test_|\/test_[^/]+$/i.test(f);
}

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function exists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
