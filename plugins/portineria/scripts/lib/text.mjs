// Utilità di testo: normalizzazione dei prompt, numeri, lingua.

export function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Porta il prompt in una forma stabile per il riconoscimento delle domande:
// niente accenti, apostrofi dritti, spazi singoli, niente punteggiatura finale
// e niente formule di cortesia all'inizio o alla fine.
export function cleanPrompt(prompt) {
  let s = stripAccents(String(prompt))
    .replace(/[‘’ʼ´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 2; i++) {
    s = s.replace(/^(?:ehi|ehm|ciao|scusa|senti|dimmi|ok|okay|hey|hi|please|per favore|perfavore)[,!:]?\s+/i, '');
    s = s.replace(/[\s,]*(?:per favore|perfavore|please|grazie|thanks|thank you)$/i, '');
    s = s.replace(/[\s?!.…:]+$/u, '');
  }
  return s.trim();
}

export function fmtNum(n, lang = 'it') {
  const s = String(Math.round(Number(n) || 0));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : '.');
}

const IT_HINTS = /\b(?:il|lo|la|gli|le|di|del|della|che|come|cosa|dove|quale|quali|perche|sono|ho|abbiamo|non|una|uno|per|con|questo|questa|quanto|quanti)\b/i;

export function guessLang(text) {
  return IT_HINTS.test(stripAccents(String(text))) ? 'it' : 'en';
}

export function truncate(s, max) {
  s = String(s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
