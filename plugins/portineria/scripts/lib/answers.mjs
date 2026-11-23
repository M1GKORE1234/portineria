// Costruzione delle risposte locali. Ogni funzione restituisce il testo della
// risposta, oppure null quando non è sicura: in quel caso la domanda passa a Claude.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { escapeRe, fmtNum, truncate } from './text.mjs';
import {
  git, gitRoot, projectRoot, listFiles, grepWord, grepRegex, isTestPath, readJson, readText, exists,
} from './repo.mjs';
import { sessionTotals } from './tokens.mjs';
import { readStats } from './store.mjs';

const t = (lang, it, en) => (lang === 'en' ? en : it);
const MAX_LINE = 140;
const line = (s) => truncate(String(s).replace(/\t/g, '  ').trim(), MAX_LINE);

// ---------------------------------------------------------------- definizioni

function definitionPatterns(E, file) {
  const ext = path.extname(file).toLowerCase();
  const p = [
    String.raw`\bfunction\s*\*?\s*${E}\s*[<(]`,
    String.raw`\b(?:abstract\s+|sealed\s+|data\s+|final\s+|partial\s+|open\s+)*class\s+${E}(?![\w$])`,
    String.raw`\b(?:const|let|var)\s+${E}\s*(?::[^=]+)?=`,
    String.raw`\b(?:interface|type|enum|typealias)\s+${E}(?![\w$])`,
    String.raw`\bdef\s+(?:self\.)?${E}(?![\w$])`,
    String.raw`\bfunc\s+(?:\([^)]*\)\s*)?${E}\s*[(<[]`,
    String.raw`\bfn\s+${E}\s*[<(]`,
    String.raw`\b(?:struct|trait|module|protocol|record|object|mod|union|namespace|extension|impl)\s+${E}(?![\w$])`,
    String.raw`\bfun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?${E}\s*\(`,
    String.raw`\b(?:class_name|signal)\s+${E}(?![\w$])`,
    String.raw`^\s*(?:(?:public|private|protected|static|async|override|readonly|get|set|final|virtual|internal|abstract|export|default)\s+)*\*?${E}\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^={;]+)?\{`,
    String.raw`(?:^|[\s,{])${E}\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)`,
    String.raw`^\s*(?:export\s+)?(?:this\.|self\.)?${E}\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>|lambda\b)`,
    String.raw`(?:^|\s)(?:public|private|protected|internal|static)\s+(?:[\w<>[\],.?]+\s+)+${E}\s*\(`,
  ];
  if (['.py', '.rb', '.gd', '.r', '.jl', '.ex', '.exs', '.lua'].includes(ext)) p.push(String.raw`^${E}\s*(?::[^=]+)?=(?!=)`);
  if (['.sh', '.bash', '.zsh'].includes(ext)) p.push(String.raw`^(?:function\s+)?${E}\s*\(\)`);
  return p.map((s) => new RegExp(s));
}

const isComment = (s) => /^\s*(?:\/\/|#(?!define)|\*|\/\*|--|;)/.test(s);

function rank(a, b) {
  const score = (h) => (isTestPath(h.file) ? 2 : 0) + (/\.d\.ts$/.test(h.file) ? 1 : 0);
  return score(a) - score(b) || a.file.length - b.file.length || a.line - b.line;
}

function answerDefinition({ sym }, ctx) {
  const root = projectRoot(ctx.cwd);
  const name = sym.split('.').pop();
  const E = escapeRe(name);
  const defs = grepWord(root, name)
    .filter((h) => !isComment(h.text) && definitionPatterns(E, h.file).some((re) => re.test(h.text)))
    .sort(rank);
  if (!defs.length) return null;
  const L = ctx.lang;
  const out = [];
  const label = sym.includes('.') ? `${sym} (${t(L, 'cerco', 'looking for')} «${name}»)` : sym;
  out.push(defs.length === 1
    ? t(L, `Definizione di «${label}»:`, `Definition of «${label}»:`)
    : t(L, `«${label}» ha ${defs.length} definizioni:`, `«${label}» has ${defs.length} definitions:`));
  for (const d of defs.slice(0, 8)) out.push(`  ${d.file}:${d.line}   ${line(d.text)}`);
  if (defs.length > 8) out.push(t(L, `  … e altre ${defs.length - 8}`, `  … and ${defs.length - 8} more`));
  return out.join('\n');
}

// ---------------------------------------------------------------- utilizzi

function answerUsages({ sym }, ctx) {
  const root = projectRoot(ctx.cwd);
  const name = sym.split('.').pop();
  const hits = grepWord(root, name);
  const L = ctx.lang;
  if (!hits.length) return t(L, `«${name}» non compare in nessun file del progetto.`, `«${name}» doesn't appear in any project file.`);
  const E = escapeRe(name);
  const byFile = new Map();
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) || 0) + 1);
  const files = [...byFile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = [t(L,
    `«${name}» compare ${hits.length} ${hits.length === 1 ? 'volta' : 'volte'} in ${files.length} file:`,
    `«${name}» appears ${hits.length} ${hits.length === 1 ? 'time' : 'times'} in ${files.length} ${files.length === 1 ? 'file' : 'files'}:`)];
  for (const [f, n] of files.slice(0, 12)) out.push(`  ${f}  (${n})`);
  if (files.length > 12) out.push(t(L, `  … e altri ${files.length - 12} file`, `  … and ${files.length - 12} more files`));
  out.push('', t(L, 'Prime righe:', 'First lines:'));
  const sorted = [...hits].sort(rank);
  for (const h of sorted.slice(0, 10)) {
    const isDef = definitionPatterns(E, h.file).some((re) => re.test(h.text));
    out.push(`  ${h.file}:${h.line}   ${line(h.text)}${isDef ? t(L, '   ← definizione', '   ← definition') : ''}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- file

function resolveFile(file, ctx) {
  const root = projectRoot(ctx.cwd);
  const clean = file.replace(/^\.\//, '');
  for (const base of [ctx.cwd, root]) {
    const abs = path.resolve(base, clean);
    if (exists(abs)) return { matches: [path.relative(root, abs).split(path.sep).join('/') || clean], root };
  }
  const files = listFiles(root);
  const lower = clean.toLowerCase();
  let matches = files.filter((f) => f === clean || f.endsWith('/' + clean));
  if (!matches.length) matches = files.filter((f) => f.toLowerCase() === lower || f.toLowerCase().endsWith('/' + lower));
  if (!matches.length && !clean.includes('/')) matches = files.filter((f) => path.posix.basename(f).toLowerCase() === lower);
  return { matches, root };
}

function answerFindFile({ file }, ctx) {
  const { matches } = resolveFile(file, ctx);
  if (!matches.length) return null;
  const L = ctx.lang;
  const out = [matches.length === 1
    ? t(L, `«${file}» si trova qui:`, `«${file}» is here:`)
    : t(L, `Ci sono ${matches.length} file chiamati «${file}»:`, `There are ${matches.length} files named «${file}»:`)];
  for (const m of matches.slice(0, 12)) out.push(`  ${m}`);
  if (matches.length > 12) out.push(t(L, `  … e altri ${matches.length - 12}`, `  … and ${matches.length - 12} more`));
  return out.join('\n');
}

function answerShowFile({ file }, ctx) {
  if (!/[./\\]/.test(file)) return null;
  const { matches, root } = resolveFile(file, ctx);
  const L = ctx.lang;
  if (!matches.length) return null;
  if (matches.length > 1) {
    return [t(L, `Ci sono ${matches.length} file che corrispondono a «${file}». Quale vuoi vedere?`, `${matches.length} files match «${file}». Which one?`),
      ...matches.slice(0, 12).map((m) => `  ${m}`)].join('\n');
  }
  const rel = matches[0];
  const txt = readText(path.join(root, rel));
  if (txt === null) return null;
  const lines = txt.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const shown = lines.slice(0, 120);
  const w = String(shown.length).length;
  const out = [`${rel}  (${lines.length} ${t(L, lines.length === 1 ? 'riga' : 'righe', lines.length === 1 ? 'line' : 'lines')})`, ''];
  shown.forEach((l, i) => out.push(`${String(i + 1).padStart(w)} │ ${truncate(l.replace(/\t/g, '  '), 200)}`));
  if (lines.length > shown.length) {
    out.push('', t(L, `… mostrate le prime ${shown.length} righe di ${lines.length}.`, `… showing the first ${shown.length} of ${lines.length} lines.`));
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- comandi

const SUBJECTS = {
  test: { re: /test|spec|unit|e2e/i, names: /^(?:test|tests|unit|e2e|spec|vitest|jest|pytest)(?:[:\-_].*)?$/i, it: 'i test', en: 'tests' },
  build: { re: /build|compil/i, names: /^(?:build|compile)(?:[:\-_].*)?$/i, it: 'la build', en: 'the build' },
  start: { re: /progetto|project|app|applicazione|application|server|sviluppo|dev|sito|site|website|start|run|launch|serve|lancio|avvio|esegu|partire|girare/i, names: /^(?:dev|start|serve|preview|develop|run)(?:[:\-_].*)?$/i, it: 'avviare il progetto', en: 'starting the project' },
  lint: { re: /lint/i, names: /^(?:lint)(?:[:\-_].*)?$/i, it: 'il lint', en: 'linting' },
  typecheck: { re: /type\s?check|tsc/i, names: /^(?:typecheck|type-check|tsc|check-types|types|check)$/i, it: 'il controllo dei tipi', en: 'type checking' },
  deploy: { re: /deploy|release|pubblic/i, names: /^(?:deploy|release|publish)(?:[:\-_].*)?$/i, it: 'il deploy', en: 'deploying' },
  format: { re: /format|prettier/i, names: /^(?:format|fmt|prettier)(?:[:\-_].*)?$/i, it: 'la formattazione', en: 'formatting' },
};

function subjectOf(params) {
  const raw = `${params.subj || ''} ${params.verb || ''}`.trim();
  if (!raw) return null;
  for (const key of ['test', 'build', 'lint', 'typecheck', 'deploy', 'format', 'start']) {
    if (SUBJECTS[key].re.test(raw)) return key;
  }
  return null;
}

function packageManager(dir, root) {
  for (const d of [dir, root]) {
    if (exists(path.join(d, 'pnpm-lock.yaml'))) return 'pnpm';
    if (exists(path.join(d, 'yarn.lock'))) return 'yarn';
    if (exists(path.join(d, 'bun.lockb')) || exists(path.join(d, 'bun.lock'))) return 'bun';
    if (exists(path.join(d, 'package-lock.json'))) return 'npm';
  }
  return 'npm';
}

function npmCommand(pm, name) {
  if (pm === 'npm') return ['test', 'start'].includes(name) ? `npm ${name}` : `npm run ${name}`;
  if (pm === 'bun') return `bun run ${name}`;
  return `${pm} ${name}`;
}

function collectCommands(ctx) {
  const root = projectRoot(ctx.cwd);
  const dirs = [...new Set([path.resolve(ctx.cwd), root])];
  const groups = [];
  for (const dir of dirs) {
    const where = path.relative(root, dir) ? `${path.relative(root, dir).split(path.sep).join('/')}/` : '';
    const pkg = readJson(path.join(dir, 'package.json'));
    if (pkg && pkg.scripts && typeof pkg.scripts === 'object') {
      const pm = packageManager(dir, root);
      groups.push({ source: `${where}package.json`, items: Object.entries(pkg.scripts).map(([name, cmd]) => ({ name, run: npmCommand(pm, name), detail: String(cmd) })) });
    }
    const deno = readJson(path.join(dir, 'deno.json')) || readJson(path.join(dir, 'deno.jsonc'));
    if (deno && deno.tasks) groups.push({ source: `${where}deno.json`, items: Object.entries(deno.tasks).map(([name, cmd]) => ({ name, run: `deno task ${name}`, detail: String(typeof cmd === 'object' ? cmd.command || '' : cmd) })) });
    const composer = readJson(path.join(dir, 'composer.json'));
    if (composer && composer.scripts) groups.push({ source: `${where}composer.json`, items: Object.keys(composer.scripts).map((name) => ({ name, run: `composer ${name}`, detail: '' })) });
    for (const mk of ['Makefile', 'makefile', 'GNUmakefile']) {
      const txt = readText(path.join(dir, mk));
      if (!txt) continue;
      const names = [...txt.matchAll(/^([A-Za-z0-9][\w.\-]*)\s*:(?!=)/gm)].map((m) => m[1]).filter((n) => !n.startsWith('.'));
      if (names.length) groups.push({ source: `${where}${mk}`, items: [...new Set(names)].map((name) => ({ name, run: `make ${name}`, detail: '' })) });
      break;
    }
    const just = readText(path.join(dir, 'justfile')) || readText(path.join(dir, 'Justfile'));
    if (just) {
      const names = [...just.matchAll(/^@?([A-Za-z0-9][\w\-]*)(?:\s+[^:\n=]*)?:(?!=)/gm)].map((m) => m[1]);
      if (names.length) groups.push({ source: `${where}justfile`, items: [...new Set(names)].map((name) => ({ name, run: `just ${name}`, detail: '' })) });
    }
    if (exists(path.join(dir, 'Cargo.toml'))) {
      groups.push({ source: `${where}Cargo.toml`, items: [
        { name: 'build', run: 'cargo build', detail: '' }, { name: 'test', run: 'cargo test', detail: '' },
        { name: 'run', run: 'cargo run', detail: '' }, { name: 'lint', run: 'cargo clippy', detail: '' }, { name: 'format', run: 'cargo fmt', detail: '' }] });
    }
    if (exists(path.join(dir, 'go.mod'))) {
      groups.push({ source: `${where}go.mod`, items: [
        { name: 'build', run: 'go build ./...', detail: '' }, { name: 'test', run: 'go test ./...', detail: '' },
        { name: 'run', run: 'go run .', detail: '' }, { name: 'lint', run: 'go vet ./...', detail: '' }, { name: 'format', run: 'gofmt -w .', detail: '' }] });
    }
    const pyproject = readText(path.join(dir, 'pyproject.toml'));
    const reqs = readText(path.join(dir, 'requirements.txt')) || readText(path.join(dir, 'requirements-dev.txt')) || '';
    if (pyproject || reqs) {
      const items = [];
      const block = pyproject && /\[(?:project\.scripts|tool\.poetry\.scripts)\]([\s\S]*?)(?:\n\[|$)/.exec(pyproject);
      if (block) for (const m of block[1].matchAll(/^\s*([\w.\-]+)\s*=/gm)) items.push({ name: m[1], run: m[1], detail: '' });
      if (/\bpytest\b/i.test(`${pyproject || ''}\n${reqs}`)) items.push({ name: 'test', run: 'pytest', detail: '' });
      if (/\bruff\b/i.test(`${pyproject || ''}\n${reqs}`)) items.push({ name: 'lint', run: 'ruff check .', detail: '' });
      if (exists(path.join(dir, 'manage.py'))) items.push({ name: 'start', run: 'python manage.py runserver', detail: '' });
      if (items.length) groups.push({ source: `${where}${pyproject ? 'pyproject.toml' : 'requirements.txt'}`, items });
    }
  }
  return groups;
}

function answerScripts(params, ctx) {
  const groups = collectCommands(ctx);
  if (!groups.length) return null;
  const L = ctx.lang;
  const subj = subjectOf(params);
  const out = [];
  if (subj) {
    const hits = [];
    for (const g of groups) for (const it of g.items) if (SUBJECTS[subj].names.test(it.name)) hits.push(it);
    if (!hits.length) return null;
    const best = hits.find((h) => !/[:\-_]/.test(h.name)) || hits[0];
    out.push(t(L, `Per ${SUBJECTS[subj].it}:  ${best.run}`, `For ${SUBJECTS[subj].en}:  ${best.run}`));
    if (best.detail) out.push(t(L, `  (esegue: ${truncate(best.detail, 100)})`, `  (runs: ${truncate(best.detail, 100)})`));
    const others = hits.filter((h) => h !== best);
    if (others.length) out.push(t(L, `Varianti: ${others.slice(0, 6).map((h) => h.run).join(' · ')}`, `Variants: ${others.slice(0, 6).map((h) => h.run).join(' · ')}`));
    out.push('');
  }
  out.push(t(L, 'Comandi del progetto:', 'Project commands:'));
  for (const g of groups) {
    out.push(`  ${g.source}`);
    const width = Math.min(28, Math.max(...g.items.map((i) => i.run.length)));
    for (const it of g.items.slice(0, 25)) out.push(`    ${it.run.padEnd(width)}  ${truncate(it.detail, 70)}`.trimEnd());
    if (g.items.length > 25) out.push(t(L, `    … e altri ${g.items.length - 25}`, `    … and ${g.items.length - 25} more`));
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- git

function relDate(s, L) {
  if (L === 'en') return s;
  const units = { second: ['secondo', 'secondi'], minute: ['minuto', 'minuti'], hour: ['ora', 'ore'], day: ['giorno', 'giorni'], week: ['settimana', 'settimane'], month: ['mese', 'mesi'], year: ['anno', 'anni'] };
  return s
    .replace(/(\d+) (second|minute|hour|day|week|month|year)s? ago/g, (_, n, u) => `${n} ${units[u][n === '1' ? 0 : 1]} fa`)
    .replace(/, (\d+) (month|year)s?/g, (_, n, u) => ` e ${n} ${units[u][n === '1' ? 0 : 1]}`);
}

const STATUS_WORDS = {
  it: { M: 'modificato', A: 'aggiunto', D: 'eliminato', R: 'rinominato', C: 'copiato', U: 'in conflitto', '?': 'nuovo, non tracciato' },
  en: { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict', '?': 'new, untracked' },
};

function commitLines(root, L, { n = 10, since, until } = {}) {
  const args = ['log', `-n`, String(n), '--pretty=format:%h%x00%ar%x00%an%x00%s'];
  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);
  const r = git(args, root);
  if (!r.ok) return null;
  return r.out.split('\n').filter(Boolean).map((l) => {
    const [h, when, who, subject] = l.split('\0');
    return `  ${h}  ${relDate(when, L).padEnd(16)}  ${truncate(subject, 80)}  — ${who}`;
  });
}

function answerStatus(params, ctx) {
  const root = gitRoot(ctx.cwd);
  if (!root) return null;
  const L = ctx.lang;
  const st = git(['status', '--porcelain=v1', '--branch'], root);
  if (!st.ok) return null;
  const lines = st.out.split('\n').filter(Boolean);
  const head = lines[0] && lines[0].startsWith('## ') ? lines.shift().slice(3) : '';
  const hasHead = git(['rev-parse', '--verify', '-q', 'HEAD'], root).ok;
  const num = new Map();
  if (hasHead) {
    const ns = git(['diff', '--numstat', 'HEAD'], root);
    for (const l of ns.out.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
      if (m) num.set(m[3].replace(/^.*\{(.*) => (.*)\}.*$/, '$2'), [m[1], m[2]]);
    }
  }
  const out = [];
  const branch = head.replace(/^No commits yet on /, '').split('...')[0];
  const ahead = /ahead (\d+)/.exec(head);
  const behind = /behind (\d+)/.exec(head);
  let bl = t(L, `Branch: ${branch}`, `Branch: ${branch}`);
  if (ahead) bl += t(L, ` · ${ahead[1]} commit da pubblicare`, ` · ${ahead[1]} commit(s) to push`);
  if (behind) bl += t(L, ` · ${behind[1]} commit da scaricare`, ` · ${behind[1]} commit(s) to pull`);
  out.push(bl);
  if (!lines.length) {
    out.push(t(L, 'Nessuna modifica in sospeso: è tutto committato.', 'No pending changes: everything is committed.'));
  } else {
    out.push(t(L, `${lines.length} ${lines.length === 1 ? 'file' : 'file'} con modifiche non committate:`, `${lines.length} ${lines.length === 1 ? 'file' : 'files'} with uncommitted changes:`));
    const W = STATUS_WORDS[L === 'en' ? 'en' : 'it'];
    for (const l of lines.slice(0, 30)) {
      const code = l.slice(0, 2);
      const file = l.slice(3).replace(/^.* -> /, '');
      const key = code === '??' ? '?' : (code.trim()[0] || 'M');
      const n = num.get(file);
      const delta = n && n[0] !== '-' ? `  +${n[0]} −${n[1]}` : '';
      out.push(`  ${code.replace(/ /g, '·')}  ${file}${delta}   (${W[key] || code.trim()})`);
    }
    if (lines.length > 30) out.push(t(L, `  … e altri ${lines.length - 30}`, `  … and ${lines.length - 30} more`));
  }
  if (params.when && /oggi|today/i.test(params.when) && hasHead) {
    const today = commitLines(root, L, { n: 30, since: 'midnight' }) || [];
    out.push('', today.length ? t(L, 'Commit di oggi:', "Today's commits:") : t(L, 'Nessun commit oggi.', 'No commits today.'), ...today);
  } else if (!lines.length && hasHead) {
    const last = commitLines(root, L, { n: 1 });
    if (last && last.length) out.push(t(L, 'Ultimo commit:', 'Last commit:'), ...last);
  }
  return out.join('\n');
}

function answerCommits(params, ctx) {
  const root = gitRoot(ctx.cwd);
  if (!root || !git(['rev-parse', '--verify', '-q', 'HEAD'], root).ok) return null;
  const L = ctx.lang;
  const n = Math.min(Math.max(params.n || 10, 1), 30);
  let opts = { n };
  let title = t(L, `Ultimi ${n} commit:`, `Last ${n} commits:`);
  if (params.when && /oggi|today/i.test(params.when)) { opts = { n: 50, since: 'midnight' }; title = t(L, 'Commit di oggi:', "Today's commits:"); }
  if (params.when && /ieri|yesterday/i.test(params.when)) { opts = { n: 50, since: 'yesterday.midnight', until: 'midnight' }; title = t(L, 'Commit di ieri:', "Yesterday's commits:"); }
  const lines = commitLines(root, L, opts);
  if (!lines) return null;
  if (!lines.length) return t(L, 'Nessun commit nel periodo richiesto.', 'No commits in that period.');
  if (n === 1 && !params.when) title = t(L, 'Ultimo commit:', 'Last commit:');
  return [title, ...lines].join('\n');
}

function answerBranch(_params, ctx) {
  const root = gitRoot(ctx.cwd);
  if (!root) return null;
  const L = ctx.lang;
  let name = git(['branch', '--show-current'], root).out.trim();
  if (!name) {
    const sha = git(['rev-parse', '--short', 'HEAD'], root).out.trim();
    if (!sha) return null;
    return t(L, `Non sei su un branch: HEAD è staccata sul commit ${sha}.`, `You're not on a branch: HEAD is detached at ${sha}.`);
  }
  const up = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root);
  let extra = '';
  if (up.ok) {
    const c = git(['rev-list', '--left-right', '--count', '@{u}...HEAD'], root).out.trim().split(/\s+/);
    const behind = Number(c[0] || 0);
    const ahead = Number(c[1] || 0);
    extra = t(L, ` (rispetto a ${up.out.trim()}: ${ahead} avanti, ${behind} indietro)`, ` (vs ${up.out.trim()}: ${ahead} ahead, ${behind} behind)`);
  } else {
    extra = t(L, ' (nessun branch remoto collegato)', ' (no upstream branch)');
  }
  return t(L, `Sei sul branch «${name}»${extra}.`, `You're on branch «${name}»${extra}.`);
}

function answerBranches(_params, ctx) {
  const root = gitRoot(ctx.cwd);
  if (!root) return null;
  const L = ctx.lang;
  const r = git(['for-each-ref', '--sort=-committerdate', 'refs/heads', '--format=%(HEAD)%00%(refname:short)%00%(committerdate:relative)'], root);
  if (!r.ok) return null;
  const rows = r.out.split('\n').filter(Boolean).map((l) => l.split('\0'));
  if (!rows.length) return null;
  const out = [t(L, `${rows.length} branch locali (dal più recente):`, `${rows.length} local branches (most recent first):`)];
  for (const [cur, name, when] of rows.slice(0, 20)) out.push(`  ${cur === '*' ? '*' : ' '} ${name.padEnd(30)} ${relDate(when, L)}`);
  if (rows.length > 20) out.push(t(L, `  … e altri ${rows.length - 20}`, `  … and ${rows.length - 20} more`));
  return out.join('\n');
}

// ---------------------------------------------------------------- TODO

function answerTodos(_params, ctx) {
  const root = projectRoot(ctx.cwd);
  const L = ctx.lang;
  const hits = grepRegex(root, '(^|[^[:alnum:]_])(TODO|FIXME|HACK|XXX)([^[:alnum:]_]|$)', /(?<![\w])(?:TODO|FIXME|HACK|XXX)(?![\w])/);
  if (!hits.length) return t(L, 'Nessun TODO, FIXME, HACK o XXX nel progetto.', 'No TODO, FIXME, HACK or XXX in the project.');
  const counts = {};
  for (const h of hits) {
    const tag = /(TODO|FIXME|HACK|XXX)/.exec(h.text)?.[1] || 'TODO';
    counts[tag] = (counts[tag] || 0) + 1;
  }
  const summary = ['TODO', 'FIXME', 'HACK', 'XXX'].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(' · ');
  const out = [t(L, `Trovati: ${summary}`, `Found: ${summary}`)];
  for (const h of hits.slice(0, 25)) out.push(`  ${h.file}:${h.line}   ${line(h.text)}`);
  if (hits.length > 25) out.push(t(L, `  … e altri ${hits.length - 25}`, `  … and ${hits.length - 25} more`));
  return out.join('\n');
}

// ---------------------------------------------------------------- versioni

const RUNTIMES = {
  node: ['node', '--version'], nodejs: ['node', '--version'], npm: ['npm', '--version'], pnpm: ['pnpm', '--version'],
  yarn: ['yarn', '--version'], bun: ['bun', '--version'], deno: ['deno', '--version'], python: ['python3', '--version'],
  python3: ['python3', '--version'], pip: ['pip', '--version'], git: ['git', '--version'], go: ['go', 'version'],
  golang: ['go', 'version'], rust: ['rustc', '--version'], rustc: ['rustc', '--version'], cargo: ['cargo', '--version'],
  java: ['java', '-version'], php: ['php', '--version'], ruby: ['ruby', '--version'], dotnet: ['dotnet', '--version'],
  godot: ['godot', '--version'], docker: ['docker', '--version'], typescript: null,
};

function runtimeVersion(cmd, args) {
  const win = process.platform === 'win32';
  const r = win
    ? spawnSync(`${cmd} ${args.join(' ')}`, { shell: true, encoding: 'utf8', timeout: 4000, windowsHide: true })
    : spawnSync(cmd, args, { encoding: 'utf8', timeout: 4000, windowsHide: true });
  if (r.error || r.status !== 0) {
    if (cmd === 'python3') return runtimeVersion('python', args);
    return null;
  }
  const text = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n')[0];
  return text || null;
}

function depVersions(pkg, ctx) {
  const root = projectRoot(ctx.cwd);
  const dirs = [...new Set([path.resolve(ctx.cwd), root])];
  const found = [];
  const lower = pkg.toLowerCase();
  const esc = escapeRe(pkg);
  for (const dir of dirs) {
    const where = path.relative(root, dir) ? `${path.relative(root, dir).split(path.sep).join('/')}/` : '';
    const pj = readJson(path.join(dir, 'package.json'));
    if (pj) {
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const v = pj[field] && (pj[field][pkg] ?? Object.entries(pj[field]).find(([k]) => k.toLowerCase() === lower)?.[1]);
        if (v) found.push({ what: t(ctx.lang, 'dichiarata', 'declared'), version: v, source: `${where}package.json (${field})` });
      }
    }
    const installed = readJson(path.join(dir, 'node_modules', pkg, 'package.json'));
    if (installed && installed.version) found.push({ what: t(ctx.lang, 'installata', 'installed'), version: installed.version, source: `${where}node_modules/${pkg}` });
    for (const f of ['requirements.txt', 'requirements-dev.txt']) {
      const txt = readText(path.join(dir, f));
      const m = txt && new RegExp(`^${esc}(?:\\[[^\\]]*\\])?\\s*([=<>!~]=?[^;#\\s]+(?:,[^;#\\s]+)*)`, 'im').exec(txt);
      if (m) found.push({ what: t(ctx.lang, 'richiesta', 'required'), version: m[1], source: `${where}${f}` });
    }
    const py = readText(path.join(dir, 'pyproject.toml'));
    if (py) {
      const m = new RegExp(`["']${esc}(?:\\[[^\\]]*\\])?\\s*([=<>!~^][^"']*)["']`, 'i').exec(py) || new RegExp(`^${esc}\\s*=\\s*["']([^"']+)["']`, 'im').exec(py);
      if (m) found.push({ what: t(ctx.lang, 'richiesta', 'required'), version: m[1], source: `${where}pyproject.toml` });
    }
    const cargo = readText(path.join(dir, 'Cargo.toml'));
    if (cargo) {
      const m = new RegExp(`^${esc}\\s*=\\s*(?:"([^"]+)"|\\{[^}\\n]*version\\s*=\\s*"([^"]+)")`, 'm').exec(cargo);
      if (m) found.push({ what: t(ctx.lang, 'richiesta', 'required'), version: m[1] || m[2], source: `${where}Cargo.toml` });
    }
    const gomod = readText(path.join(dir, 'go.mod'));
    if (gomod) {
      const m = new RegExp(`^\\s*(?:require\\s+)?(\\S*(?:^|/)${esc})\\s+(v[\\w.\\-+]+)`, 'im').exec(gomod);
      if (m) found.push({ what: t(ctx.lang, 'richiesta', 'required'), version: `${m[2]} (${m[1]})`, source: `${where}go.mod` });
    }
    const composer = readJson(path.join(dir, 'composer.json'));
    for (const field of ['require', 'require-dev']) {
      const v = composer && composer[field] && composer[field][pkg];
      if (v) found.push({ what: t(ctx.lang, 'richiesta', 'required'), version: v, source: `${where}composer.json` });
    }
  }
  return found;
}

function answerVersion({ pkg }, ctx) {
  const L = ctx.lang;
  const deps = depVersions(pkg, ctx);
  const out = [];
  if (deps.length) {
    out.push(`${pkg}:`);
    const seen = new Set();
    for (const d of deps) {
      const key = `${d.what}|${d.version}|${d.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`  ${d.what} ${d.version}   (${d.source})`);
    }
  }
  const rt = RUNTIMES[pkg.toLowerCase()];
  if (rt) {
    const v = pkg.toLowerCase().startsWith('node') ? `${process.version}` : runtimeVersion(rt[0], rt.slice(1));
    if (v) out.push(t(L, `${pkg} installato su questo computer: ${v}`, `${pkg} installed on this machine: ${v}`));
  }
  return out.length ? out.join('\n') : null;
}

// ---------------------------------------------------------------- token

function answerTokens(_params, ctx) {
  const L = ctx.lang;
  const tot = sessionTotals(ctx.transcriptPath);
  const stats = readStats();
  const sess = stats.sessions[ctx.sessionId] || { answers: 0, saved: 0 };
  const out = [];
  if (tot && tot.calls) {
    out.push(t(L, `Sessione corrente${tot.model ? ` (${tot.model})` : ''}:`, `Current session${tot.model ? ` (${tot.model})` : ''}:`));
    out.push(t(L,
      `  Contesto attuale: ~${fmtNum(tot.lastContext, L)} token. Claude li rilegge a ogni nuovo messaggio.`,
      `  Current context: ~${fmtNum(tot.lastContext, L)} tokens. Claude re-reads them on every new message.`));
    out.push(t(L, `  Chiamate al modello: ${fmtNum(tot.calls, L)}`, `  Model calls: ${fmtNum(tot.calls, L)}`));
    out.push(t(L,
      `  Letti dalla cache: ${fmtNum(tot.cacheRead, L)} · scritti in cache: ${fmtNum(tot.cacheWrite, L)} · input nuovo: ${fmtNum(tot.input, L)} · generati: ${fmtNum(tot.output, L)}`,
      `  Cache reads: ${fmtNum(tot.cacheRead, L)} · cache writes: ${fmtNum(tot.cacheWrite, L)} · new input: ${fmtNum(tot.input, L)} · output: ${fmtNum(tot.output, L)}`));
  } else {
    out.push(t(L, 'Questa sessione non ha ancora chiamato il modello.', "This session hasn't called the model yet."));
  }
  out.push(t(L,
    `  Portineria in questa sessione: ${sess.answers} risposte, ~${fmtNum(sess.saved, L)} token di contesto evitati.`,
    `  Portineria this session: ${sess.answers} answers, ~${fmtNum(sess.saved, L)} context tokens avoided.`));
  out.push('', t(L, 'Per il dettaglio ufficiale: /context e /usage (anche loro non consumano token).', 'For the official breakdown: /context and /usage (they cost no tokens either).'));
  return out.join('\n');
}

// ---------------------------------------------------------------- struttura

function answerTree(_params, ctx) {
  const root = projectRoot(ctx.cwd);
  const files = listFiles(root);
  if (!files.length) return null;
  const L = ctx.lang;
  const top = new Map();
  const rootFiles = [];
  for (const f of files) {
    const parts = f.split('/');
    if (parts.length === 1) { rootFiles.push(f); continue; }
    const d = top.get(parts[0]) || { count: 0, subs: new Map() };
    d.count++;
    if (parts.length > 2) d.subs.set(parts[1], (d.subs.get(parts[1]) || 0) + 1);
    top.set(parts[0], d);
  }
  const out = [t(L, `${path.basename(root)} · ${fmtNum(files.length, L)} file`, `${path.basename(root)} · ${fmtNum(files.length, L)} files`)];
  let budget = 45;
  for (const [name, d] of [...top.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (budget-- <= 0) break;
    out.push(`  ${name}/  (${d.count})`);
    const subs = [...d.subs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [s, c] of subs.slice(0, 8)) { if (budget-- <= 0) break; out.push(`    ${s}/  (${c})`); }
    if (subs.length > 8) out.push(t(L, `    … e altre ${subs.length - 8} cartelle`, `    … and ${subs.length - 8} more folders`));
  }
  if (rootFiles.length) {
    const shown = rootFiles.slice(0, 15).join(' · ');
    out.push(`  ${shown}${rootFiles.length > 15 ? t(L, ` · … (+${rootFiles.length - 15})`, ` · … (+${rootFiles.length - 15})`) : ''}`);
  }
  return out.join('\n');
}

const BUILDERS = {
  definition: answerDefinition,
  usages: answerUsages,
  findfile: answerFindFile,
  showfile: answerShowFile,
  scripts: answerScripts,
  status: answerStatus,
  commits: answerCommits,
  branch: answerBranch,
  branches: answerBranches,
  todos: answerTodos,
  version: answerVersion,
  tokens: answerTokens,
  tree: answerTree,
};

export function buildAnswer(candidate, ctx) {
  const fn = BUILDERS[candidate.intent];
  if (!fn) return null;
  try {
    return fn(candidate.params || {}, { ...ctx, lang: candidate.lang });
  } catch {
    return null;
  }
}

// Usato dai test.
export const _internal = { definitionPatterns, collectCommands, subjectOf, relDate };
