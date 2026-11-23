# 🛎️ Portineria

**Il plugin per Claude Code che risponde da solo, a 0 token, alle domande che non hanno bisogno di Claude.**

*English below.*

---

## Il problema

In Claude Code ogni messaggio fa rileggere a Claude **tutto il contesto della sessione**. Dopo un'ora di lavoro il contesto può superare i 150.000 token: a quel punto anche una domanda banale come *"dov'è definita `parseUser`?"* o *"qual è il comando per i test?"* costa quanto una richiesta complessa. Spesso costa anche di più, perché Claude deve prima cercare (un turno) e poi rispondere (un altro turno), rileggendo il contesto ogni volta.

Sono domande con una risposta esatta, che `git` e una ricerca nel codice danno in pochi millisecondi.

## Cosa fa

La Portineria si mette all'ingresso: legge ogni prompt **prima** che arrivi a Claude.

- Se è una domanda a cui si può rispondere in locale, risponde lei. Claude non viene chiamato e la risposta costa **0 token**.
- Tutto il resto passa a Claude **esattamente com'era**, senza aggiunte.

```
> dov'è definita parseUser?

🛎️ Portineria · risposta locale, 0 token
Claude non è stato interpellato: evitata la rilettura di ~152.300 token di contesto.

Definizione di «parseUser»:
  src/utils/user.ts:3   export function parseUser(raw: string): User {
```

## Cosa sa rispondere

| Chiedi (in italiano o in inglese) | Ottieni |
|---|---|
| `dov'è definita parseUser?` · `dove si trova la classe UserCard` · `where is formatDate defined?` | file e riga della definizione (TS/JS, Python, Go, Rust, Java, Kotlin, C#, PHP, Ruby, GDScript…) |
| `dove viene usato parseUser?` · `chi chiama formatDate` · `find usages of X` | quante volte compare, in quali file, prime righe |
| `dov'è il file config.json?` · `mostrami package.json` | percorso del file / contenuto con numeri di riga |
| `come lancio i test?` · `come si fa la build` · `quali script ci sono?` | il comando giusto (npm/pnpm/yarn/bun, make, just, cargo, go, deno, composer, pytest…) |
| `cosa ho cambiato?` · `cosa ho fatto oggi?` · `git status` | file modificati con righe aggiunte/tolte, commit di oggi |
| `ultimi 5 commit` · `su che branch sono?` · `quali branch ci sono` | storico, branch corrente, avanti/indietro rispetto al remoto |
| `elenca i todo` · `ci sono FIXME?` | tutti i TODO / FIXME / HACK / XXX |
| `che versione di react uso?` · `che versione di node uso` | versione dichiarata e installata |
| `quanti token ho usato?` · `quanto è pieno il contesto?` | contesto attuale e totali della sessione |
| `struttura del progetto` | albero delle cartelle con il numero di file |

## Come decide (e perché non sbaglia)

- **Precisione prima di tutto.** Intercetta solo le frasi che sono *esattamente* una di queste domande. *"dov'è definita parseUser e perché fallisce?"* va a Claude, perché contiene una richiesta in più.
- **Nomi che sembrano codice.** *"dov'è login"* va a Claude (potresti intendere la pagina di login); *"dov'è `login`"*, *"dov'è la funzione login"* e *"dov'è loginUser"* no.
- **Se non è sicura, passa.** Nessuna definizione trovata, nessuno script per i test, non è un repository git: la domanda va a Claude.
- **Qualunque errore = la domanda va a Claude.** Il plugin non può bloccare il tuo lavoro.
- **Non modifica niente.** Legge e basta: nessun file scritto nel progetto, nessuna rete.

## Prefissi e comandi

| Scrivi | Effetto |
|---|---|
| `?domanda` | Chiedi esplicitamente alla Portineria, anche con nomi semplici (`?dov'è definita login`) |
| `??domanda` | **Risposta rapida**: la domanda va a Haiku **senza la cronologia della sessione** (poche centinaia di token invece del contesto intero). Per domande generiche: `?? come annullo l'ultimo commit senza perdere le modifiche?` |
| `>domanda` | Salta la Portineria: la domanda va a Claude |
| `?aiuto` · `?help` | Cosa sa fare |
| `?stats` | Risposte date e token di contesto evitati (sessione e totale) |
| `?off` · `?on` | Mette in pausa / riattiva la Portineria nel progetto corrente |

## Installazione

Requisiti: **Node.js 18+** (lo hai se lavori con JavaScript) e una versione recente di Claude Code (testato con la 2.1.330). Git è consigliato ma non obbligatorio.

**Da GitHub** (dentro Claude Code):

```
/plugin marketplace add M1GKORE1234/portineria
/plugin install portineria@kore-plugins
```

**Per provarla senza installarla** (dalla cartella in cui hai scaricato il repository):

```
claude --plugin-dir ./plugins/portineria
```

Poi scrivi `?aiuto`.

## Quanto fa risparmiare

Dipende da quanto è grande il contesto quando fai la domanda. Ogni risposta locale evita **almeno** una rilettura del contesto: con 100.000 token di contesto, dieci domande "di servizio" in una sessione sono un milione di token che non spendi. `?stats` ti mostra il conto reale, calcolato dalla trascrizione della tua sessione.

La stima è prudente: conta una sola rilettura, anche se spesso Claude ne avrebbe fatte due (cerca e poi risponde).

## Privacy

Tutto avviene sul tuo computer. La Portineria legge il progetto con `git` e con il file system, e legge la trascrizione della sessione solo per sapere quanto è grande il contesto. Le statistiche stanno nella cartella dati del plugin (`~/.claude/plugins/data/…`). L'unica chiamata a un modello è la corsia `??`, che usa il tuo Claude Code con Haiku.

## Limiti onesti

- Le definizioni si trovano con schemi testuali per i linguaggi più comuni: un caso molto particolare può sfuggire. Se non trova nulla, la domanda va a Claude.
- Il risparmio mostrato è una stima basata sull'ultimo contesto registrato nella sessione.
- Non sostituisce il ragionamento di Claude: risponde solo a domande con una risposta esatta.

## Sviluppo

```
node --test tests/portineria.test.mjs   # 16 test end-to-end
claude plugin validate . --strict
```

Licenza MIT · di Alessio Kore

---

## English

**Portineria** (Italian for *the concierge's desk*) is a Claude Code plugin that answers, locally and at **0 tokens**, the questions that don't need Claude.

Every message makes Claude re-read the whole session context. In a long session even *"where is `parseUser` defined?"* or *"how do I run the tests?"* costs as much as a hard request. Portineria reads each prompt before it reaches Claude. If it's one of those exact-answer questions (definitions, usages, files, project commands, git status, recent commits, branches, TODOs, dependency versions, session token usage, project structure), it answers from `git` and the file system and Claude is never called. Everything else goes to Claude untouched.

It's precision-first: patterns match the whole prompt, so anything with an extra request goes to Claude. Any error lets the prompt through. It never writes to your project and never uses the network.

Prefixes: `?question` asks Portineria explicitly · `??question` sends a quick question to Haiku **without the session history** · `>question` skips Portineria. Commands: `?help`, `?stats`, `?off`, `?on`.

Install: `/plugin marketplace add M1GKORE1234/portineria`, then `/plugin install portineria@kore-plugins`. Try it without installing: `claude --plugin-dir ./plugins/portineria`. Requires Node.js 18+.
