#!/usr/bin/env node
// Portineria: hook UserPromptSubmit per Claude Code.
//
// Prima che un prompt arrivi a Claude, la Portineria controlla se è una domanda
// a cui si può rispondere in locale (dov'è definita una funzione, qual è il
// comando dei test, cosa ho cambiato...). Se sì, risponde lei: il prompt viene
// bloccato, Claude non rilegge il contesto e la risposta costa 0 token.
// In tutti gli altri casi non scrive nulla e il prompt passa a Claude com'è.
//
// Regola di sicurezza: qualunque errore = il prompt passa a Claude.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detect } from './lib/intents.mjs';
import { buildAnswer } from './lib/answers.mjs';
import { lastContextTokens } from './lib/tokens.mjs';
import { isPaused, setPaused, readStats, recordAnswer } from './lib/store.mjs';
import { askQuick } from './lib/quick.mjs';
import { projectRoot } from './lib/repo.mjs';
import { fmtNum, guessLang, stripAccents } from './lib/text.mjs';

const t = (lang, it, en) => (lang === 'en' ? en : it);
const MARK = '🛎️ Portineria';

function readStdin(ms = 3000) {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => { process.stdin.destroy(); resolve(data); }, ms);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
  });
}

function helpText(lang) {
  return t(lang, [
    `${MARK}: risponde in locale, a 0 token, a domande come:`,
    "  dov'è definita parseUser? · dove viene usato `formatDate`?",
    "  dov'è il file config.json? · mostrami package.json",
    '  come lancio i test? · quali script ci sono?',
    '  cosa ho cambiato? · ultimi 5 commit · su che branch sono?',
    '  elenca i TODO · che versione di react uso?',
    '  quanti token ho usato? · struttura del progetto',
    '',
    'Tutto il resto passa a Claude come sempre.',
    '',
    'Prefissi:',
    '  ?domanda    chiedi esplicitamente alla Portineria',
    '  ??domanda   risposta rapida da Haiku, senza la cronologia della sessione',
    '  >domanda    salta la Portineria e chiedi a Claude',
    '',
    'Comandi:  ?aiuto  ?stats  ?off (pausa in questo progetto)  ?on',
  ].join('\n'), [
    `${MARK} answers locally, at 0 tokens, questions such as:`,
    '  where is parseUser defined? · where is `formatDate` used?',
    '  where is config.json? · show me package.json',
    '  how do I run the tests? · list the npm scripts',
    '  what did I change? · last 5 commits · current branch',
    '  list all todos · what version of react are we using?',
    '  how many tokens have I used? · project structure',
    '',
    'Everything else goes to Claude as usual.',
    '',
    'Prefixes:',
    '  ?question   ask the Portineria explicitly',
    '  ??question  quick answer from Haiku, without the session history',
    '  >question   skip the Portineria and ask Claude',
    '',
    'Commands:  ?help  ?stats  ?off (pause in this project)  ?on',
  ].join('\n'));
}

function statsText(lang, sessionId) {
  const s = readStats();
  const sess = s.sessions[sessionId] || { answers: 0, saved: 0 };
  const top = Object.entries(s.byIntent).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(' · ');
  return t(lang, [
    `${MARK}: statistiche`,
    `  Questa sessione: ${sess.answers} risposte, ~${fmtNum(sess.saved, 'it')} token di contesto evitati`,
    `  In totale:       ${s.total.answers} risposte, ~${fmtNum(s.total.saved, 'it')} token di contesto evitati (${s.total.quick} rapide con ??)`,
    top ? `  Domande più frequenti: ${top}` : null,
    '',
    '  Stima: ogni risposta locale evita almeno una rilettura del contesto della sessione.',
  ].filter((l) => l !== null).join('\n'), [
    `${MARK}: stats`,
    `  This session: ${sess.answers} answers, ~${fmtNum(sess.saved, 'en')} context tokens avoided`,
    `  All time:     ${s.total.answers} answers, ~${fmtNum(s.total.saved, 'en')} context tokens avoided (${s.total.quick} quick ?? answers)`,
    top ? `  Most asked: ${top}` : null,
    '',
    '  Estimate: every local answer avoids at least one re-read of the session context.',
  ].filter((l) => l !== null).join('\n'));
}

function control(text, ctx) {
  const c = stripAccents(text).toLowerCase().replace(/^portineria\s+/, '').trim();
  const project = projectRoot(ctx.cwd);
  if (['', 'aiuto', 'help', 'h', 'guida'].includes(c)) return { reason: helpText(c === 'help' ? 'en' : 'it') };
  if (['stats', 'statistiche', 'risparmio', 'savings'].includes(c)) return { reason: statsText(c === 'savings' ? 'en' : 'it', ctx.sessionId) };
  if (['off', 'pausa', 'spegni', 'stop', 'pause'].includes(c)) {
    setPaused(project, true);
    return { reason: `${MARK}: in pausa per questo progetto. Tutte le domande vanno a Claude. Riattivala con ?on` };
  }
  if (['on', 'riprendi', 'accendi', 'resume', 'start'].includes(c)) {
    setPaused(project, false);
    return { reason: `${MARK}: attiva in questo progetto. Scrivi ?aiuto per vedere cosa sa fare.` };
  }
  return null;
}

function render(lang, body, saved) {
  const head = `${MARK} · ${t(lang, 'risposta locale, 0 token', 'local answer, 0 tokens')}`;
  const sub = saved
    ? t(lang, `Claude non è stato interpellato: evitata la rilettura di ~${fmtNum(saved, 'it')} token di contesto.`,
      `Claude wasn't called: ~${fmtNum(saved, 'en')} context tokens not re-read.`)
    : t(lang, 'Claude non è stato interpellato.', "Claude wasn't called.");
  const foot = t(lang, '(Volevi la risposta di Claude? Riscrivi la domanda con ">" davanti.)', '(Wanted Claude to answer? Resend the question starting with ">".)');
  return `${head}\n${sub}\n\n${body}\n\n${foot}`;
}

export function respond(rawPrompt, ctx) {
  const p = String(rawPrompt || '').trim();
  if (!p) return null;
  if (/^[/!#@>]/.test(p)) return null;

  if (p.startsWith('??')) {
    if (isPaused(projectRoot(ctx.cwd))) return null;
    const question = p.slice(2).trim();
    if (!question) return { reason: helpText('it') };
    const lang = guessLang(question);
    const ans = askQuick(question, lang);
    if (!ans) return null;
    const ctxTok = lastContextTokens(ctx.transcriptPath)?.context || 0;
    const saved = Math.max(0, ctxTok - ans.used);
    recordAnswer({ sessionId: ctx.sessionId, intent: 'quick', saved, quick: true });
    const head = `${MARK} · ${t(lang, `risposta rapida (${ans.model}, senza la cronologia)`, `quick answer (${ans.model}, no session history)`)}`;
    const sub = ctxTok
      ? t(lang, `~${fmtNum(ans.used, 'it')} token invece di ~${fmtNum(ctxTok, 'it')}.`, `~${fmtNum(ans.used, 'en')} tokens instead of ~${fmtNum(ctxTok, 'en')}.`)
      : t(lang, `~${fmtNum(ans.used, 'it')} token.`, `~${fmtNum(ans.used, 'en')} tokens.`);
    const foot = t(lang, '(Per una risposta che tenga conto del progetto, riscrivi la domanda senza "??".)', '(For an answer that knows your project, resend it without "??".)');
    return { reason: `${head}\n${sub}\n\n${ans.text}\n\n${foot}`, intent: 'quick' };
  }

  let text = p;
  let forced = false;
  if (p.startsWith('?')) {
    text = p.slice(1).trim();
    const ctl = control(text, ctx);
    if (ctl) return ctl;
    forced = true;
  } else if (/^portineria\s+\S+$/i.test(p)) {
    const ctl = control(p, ctx);
    if (ctl) return ctl;
  }

  if (isPaused(projectRoot(ctx.cwd))) return null;
  if (text.length > 200 || /\n/.test(text)) return null;

  const candidates = detect(text, { forced });
  if (!candidates) return null;
  for (const cand of candidates) {
    const body = buildAnswer(cand, ctx);
    if (!body) continue;
    const saved = lastContextTokens(ctx.transcriptPath)?.context || 0;
    recordAnswer({ sessionId: ctx.sessionId, intent: cand.intent, saved });
    return { reason: render(cand.lang, body, saved), intent: cand.intent };
  }
  return null;
}

async function main() {
  if (process.env.PORTINERIA_INNER) return;
  const raw = await readStdin();
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const ctx = {
    cwd: input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    transcriptPath: input.transcript_path || null,
    sessionId: input.session_id || null,
  };
  let result = null;
  try { result = respond(input.prompt, ctx); } catch { result = null; }
  if (!result) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: result.reason }));
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch(() => {}).finally(() => { process.exitCode = 0; });
}
