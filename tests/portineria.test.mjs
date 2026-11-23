// Test end-to-end: ogni prompt passa dal vero script dell'hook, come farebbe Claude Code.
// Avvio: node --test tests/

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './fixture.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../plugins/portineria/scripts/portineria.mjs');
let project;
let dataDir;

before(() => {
  project = makeProject();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portineria-data-'));
});

function ask(prompt, { cwd = project.dir, transcript = project.transcript, session = 'sess-1', env = {} } = {}) {
  const input = JSON.stringify({
    session_id: session, transcript_path: transcript, cwd, permission_mode: 'default',
    hook_event_name: 'UserPromptSubmit', prompt,
  });
  const r = spawnSync(process.execPath, [HOOK], {
    input, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PORTINERIA_DATA_DIR: dataDir, PORTINERIA_QUICK_TIMEOUT_MS: '1', ...env },
  });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  if (!r.stdout) return null;
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.equal(typeof out.reason, 'string');
  return out.reason;
}

const passes = (prompt) => assert.equal(ask(prompt), null, `"${prompt}" doveva passare a Claude`);

test('definizione di una funzione TypeScript', () => {
  const r = ask("Dov'è definita parseUser?");
  assert.match(r, /0 token/);
  assert.match(r, /152\.300 token di contesto/);
  assert.match(r, /src\/utils\/user\.ts:3/);
  assert.doesNotMatch(r, /UserCard\.tsx/);
});

test('definizione: classe, costante, Python, Go, inglese', () => {
  assert.match(ask('dove si trova la classe UserCard'), /src\/components\/UserCard\.tsx:3/);
  assert.match(ask('where is formatDate defined?'), /src\/utils\/user\.ts:8/);
  assert.match(ask("dov'è definita create_app"), /server\/app\.py:6/);
  assert.match(ask("dov'è MAX_USERS"), /server\/app\.py:1/);
  assert.match(ask('trova la funzione HandleLogin'), /go\/main\.go:3/);
  assert.match(ask("dov'è `Config`"), /server\/app\.py:3/);
});

test('definizione assente: passa a Claude', () => {
  passes("dov'è definita funzioneCheNonEsiste");
});

test('utilizzi di un simbolo', () => {
  const r = ask('dove viene usato parseUser?');
  assert.match(r, /compare 5 volte in 3 file/);
  assert.match(r, /src\/api\/users\.ts {2}\(2\)/);
  assert.match(r, /← definizione/);
  assert.match(ask('find usages of formatDate'), /appears 3 times in 2 files/);
});

test('file: dove si trova e contenuto', () => {
  assert.match(ask("dov'è il file config.json?"), /config\/config\.json/);
  const r = ask('mostrami src/utils/user.ts');
  assert.match(r, /src\/utils\/user\.ts {2}\(8 righe\)/);
  assert.match(r, /3 │ export function parseUser/);
  assert.match(ask('show me README.md'), /1 │ # Demo/);
});

test('comandi del progetto', () => {
  const r = ask('come lancio i test?');
  assert.match(r, /Per i test: {2}npm test/);
  assert.match(r, /npm run test:e2e/);
  assert.match(r, /make deploy/);
  assert.match(ask('come si fa la build'), /Per la build: {2}npm run build/);
  assert.match(ask('how do I run the project'), /starting the project: {2}npm run dev/);
  assert.match(ask('quali script ci sono?'), /npm run lint/);
  passes('come faccio il typecheck');
});

test('stato di git e commit', () => {
  const s = ask('cosa ho cambiato?');
  assert.match(s, /Branch: main/);
  assert.match(s, /src\/api\/users\.ts {2}\+1 −0/);
  assert.match(s, /notes\.md .*nuovo, non tracciato/);
  const c = ask('ultimi 5 commit');
  assert.match(c, /Aggiunge PAGE_SIZE/);
  assert.match(c, /Primo commit/);
  assert.match(ask('su che branch sono?'), /Sei sul branch «main» \(nessun branch remoto collegato\)/);
  assert.match(ask('current branch'), /You're on branch «main»/);
  assert.match(ask('quali branch ci sono'), /\* main/);
});

test('TODO e versioni', () => {
  const r = ask('elenca i todo');
  assert.match(r, /Trovati: 1 TODO · 1 FIXME/);
  assert.match(r, /src\/utils\/user\.ts:4/);
  const v = ask('che versione di react uso?');
  assert.match(v, /dichiarata \^18\.2\.0/);
  assert.match(v, /installata 18\.3\.1/);
  assert.match(ask('che versione di node uso'), new RegExp(process.version.replace(/\./g, '\\.')));
  passes('che versione di pacchettoinesistente uso?');
});

test('token della sessione e struttura', () => {
  const r = ask('quanti token ho usato?');
  assert.match(r, /Contesto attuale: ~152\.300 token/);
  assert.match(r, /Chiamate al modello: 3/);
  const tr = ask('struttura del progetto');
  assert.match(tr, /src\/ {2}\(3\)/);
  assert.match(tr, /utils\/ {2}\(1\)/);
  assert.doesNotMatch(tr, /node_modules/);
});

test('frasi che devono SEMPRE passare a Claude', () => {
  for (const p of [
    "dov'è il bug?",
    'correggi la funzione parseUser',
    "dov'è definita parseUser e perché fallisce?",
    "spiegami come funziona l'autenticazione",
    'cosa è cambiato in React 19?',
    'cosa hai cambiato?',
    'fix the tests',
    'come si fa una build ottimizzata con vite?',
    "dov'è login",
    'che versione di react dovrei usare?',
    'mostrami come si scrive un test',
    'aggiungi un test per parseUser',
    '/compact',
    '!git status',
    '>cosa ho cambiato?',
    '> dov\'è definita parseUser?',
    "dov'è definita parseUser?\nE poi rinominala",
    'x'.repeat(300),
    '',
  ]) passes(p);
});

test('prefisso "?" forza la Portineria anche su nomi semplici', () => {
  passes("dov'è definito login");
  assert.match(ask("?dov'è definita la funzione loadUsers"), /src\/api\/users\.ts:3/);
  assert.equal(ask("?dov'è definito login"), null); // non esiste: passa comunque a Claude
});

test('comandi: aiuto, statistiche, pausa', () => {
  assert.match(ask('?'), /risponde in locale, a 0 token/);
  assert.match(ask('?help'), /answers locally, at 0 tokens/);
  const s = ask('?stats');
  assert.match(s, /Questa sessione: \d+ risposte/);
  assert.match(ask('?off'), /in pausa per questo progetto/);
  passes("dov'è definita parseUser?");
  assert.match(ask('?on'), /attiva in questo progetto/);
  assert.match(ask("dov'è definita parseUser?"), /src\/utils\/user\.ts:3/);
});

test('corsia ?? senza CLI disponibile: passa a Claude senza errori', () => {
  assert.equal(ask('?? come si annulla l\'ultimo commit?', { env: { PATH: '/nonexistent' } }), null);
});

test('senza trascrizione e fuori da git funziona lo stesso', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'portineria-plain-'));
  fs.mkdirSync(path.join(plain, 'lib'));
  fs.writeFileSync(path.join(plain, 'lib', 'math.js'), 'function sumAll(xs) { return 0 }\n// TODO: tests\n');
  const r = ask("dov'è definita sumAll?", { cwd: plain, transcript: null });
  assert.match(r, /lib\/math\.js:1/);
  assert.match(r, /Claude non è stato interpellato\./);
  assert.match(ask('elenca i todo', { cwd: plain, transcript: null }), /lib\/math\.js:2/);
});

test('fuori da git: le domande su git ricevono una spiegazione, a 0 token', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'portineria-nogit-'));
  for (const q of ['cosa ho cambiato?', 'ultimi commit', 'su che branch sono?', 'quali branch ci sono']) {
    const r = ask(q, { cwd: plain, transcript: null });
    assert.match(r, /0 token/, q);
    assert.match(r, /non è un repository git/, q);
  }
  assert.match(ask('last commits', { cwd: plain, transcript: null }), /not a git repository/);
  // Git non installato: lo dice, invece di dire che la cartella non è un repo.
  assert.match(ask('ultimi commit', { cwd: plain, transcript: null, env: { PATH: '/nonexistent' } }), /Git non risulta installato/);
});

test('titolo dei commit: conta quelli veri', () => {
  // Il progetto di prova ha 2 commit.
  assert.match(ask('ultimi commit'), /^Tutti i commit finora \(2\):$/m);
  assert.match(ask('ultimi 10 commit'), /^Tutti i commit finora \(2\):$/m);
  const one = ask('ultimo commit');
  assert.match(one, /^Ultimo commit \(su 2 in totale\):$/m);
  assert.match(one, /Aggiunge PAGE_SIZE/);
  assert.doesNotMatch(one, /Primo commit/);
  assert.match(ask('last commit'), /^Last commit \(of 2 in total\):$/m);

  // Repo con un solo commit.
  const single = fs.mkdtempSync(path.join(os.tmpdir(), 'portineria-one-'));
  const g = (...a) => spawnSync('git', a, { cwd: single, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  assert.match(ask('ultimi commit', { cwd: single, transcript: null }), /ancora nessun commit/);
  fs.writeFileSync(path.join(single, 'a.txt'), 'a\n');
  g('add', '.');
  g('-c', 'user.name=T', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'Unico');
  const r = ask('ultimi commit', { cwd: single, transcript: null });
  assert.match(r, /^L'unico commit finora:$/m);
  assert.doesNotMatch(r, /Ultimi 10/);
});

test('input non valido o vuoto: nessun output, uscita 0', () => {
  for (const input of ['', 'non json', '{}', '{"prompt": 42}']) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: { ...process.env, PORTINERIA_DATA_DIR: dataDir } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

test('velocità: un prompt normale passa in meno di 300 ms', () => {
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) passes('implementa il login con OAuth e aggiungi i test');
  const avg = (Date.now() - t0) / 5;
  assert.ok(avg < 300, `media ${avg} ms`);
});
