// Corsia rapida "??": la domanda va a un modello piccolo (Haiku) SENZA la
// cronologia della sessione, senza strumenti e con un prompt di sistema minimo.
// Serve per le domande generiche ("come si annulla l'ultimo commit?") che non
// hanno bisogno di conoscere il progetto: costano poche centinaia di token
// invece dell'intero contesto della sessione.

import { spawnSync } from 'node:child_process';
import os from 'node:os';

const SYSTEM = {
  it: "Rispondi in italiano, in modo breve e preciso. Niente preamboli. Se la risposta dipende da un progetto che non vedi, dillo in una riga.",
  en: "Answer briefly and precisely. No preamble. If the answer depends on a project you can't see, say so in one line.",
};

export function askQuick(question, lang) {
  const model = process.env.PORTINERIA_QUICK_MODEL || 'haiku';
  const args = [
    '-p', '--model', model, '--output-format', 'json',
    '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands',
    '--system-prompt', SYSTEM[lang === 'en' ? 'en' : 'it'],
  ];
  const opts = {
    input: question,
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout: Number(process.env.PORTINERIA_QUICK_TIMEOUT_MS) || 30000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PORTINERIA_INNER: '1' },
  };
  let r;
  if (process.platform === 'win32') {
    // Su Windows "claude" può essere uno shim .cmd: serve la shell. Gli argomenti
    // sono fissi e la domanda passa da stdin, quindi non c'è nulla da iniettare.
    const cmdline = ['claude', ...args.map((a) => `"${a.replace(/"/g, "'")}"`)].join(' ');
    r = spawnSync(cmdline, { ...opts, shell: true });
  } else {
    r = spawnSync('claude', args, opts);
  }
  if (r.error || r.status !== 0 || !r.stdout) return null;
  let data;
  try {
    data = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return null;
  }
  if (!data || data.is_error || typeof data.result !== 'string' || !data.result.trim()) return null;
  const u = data.usage || {};
  const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
  return { text: data.result.trim(), used, model };
}
