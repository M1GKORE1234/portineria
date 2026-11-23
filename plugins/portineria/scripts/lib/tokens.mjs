// Lettura della trascrizione della sessione (file .jsonl scritto da Claude Code)
// per sapere quanto è grande il contesto e quanti token sono stati usati.

import fs from 'node:fs';

function usageTotal(u) {
  return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
}

function readTail(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return { text: buf.toString('utf8'), partial: start > 0 };
  } finally {
    fs.closeSync(fd);
  }
}

// Dimensione del contesto inviato a Claude nell'ultima chiamata: è quanto
// Claude avrebbe riletto (almeno) per rispondere alla domanda intercettata.
export function lastContextTokens(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const { text, partial } = readTail(transcriptPath, 2 * 1024 * 1024);
    const lines = text.split('\n');
    if (partial) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"usage"')) continue;
      try {
        const obj = JSON.parse(line);
        const u = obj?.message?.usage;
        if (obj?.type === 'assistant' && u && !obj.isSidechain) {
          const total = usageTotal(u);
          if (total > 0) return { context: total, model: obj.message.model || null };
        }
      } catch { /* riga incompleta */ }
    }
  } catch { /* trascrizione non disponibile */ }
  return null;
}

// Totali della sessione corrente, senza contare due volte lo stesso messaggio.
export function sessionTotals(transcriptPath) {
  if (!transcriptPath) return null;
  let text;
  try {
    const st = fs.statSync(transcriptPath);
    text = st.size > 200 * 1024 * 1024 ? readTail(transcriptPath, 200 * 1024 * 1024).text : fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  const byId = new Map();
  let lastContext = 0;
  let model = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const msg = obj?.message;
    if (obj?.type !== 'assistant' || !msg?.usage) continue;
    const id = msg.id || obj.uuid || String(byId.size);
    byId.set(id, msg.usage);
    if (!obj.isSidechain) {
      const t = usageTotal(msg.usage);
      if (t > 0) { lastContext = t; model = msg.model || model; }
    }
  }
  const tot = { calls: byId.size, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, lastContext, model };
  for (const u of byId.values()) {
    tot.input += u.input_tokens || 0;
    tot.cacheWrite += u.cache_creation_input_tokens || 0;
    tot.cacheRead += u.cache_read_input_tokens || 0;
    tot.output += u.output_tokens || 0;
  }
  return tot;
}
