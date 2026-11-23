// Riconoscimento delle domande a cui si può rispondere in locale.
//
// Principio guida: precisione prima di tutto. Ogni schema è ancorato all'intero
// prompt (^...$), quindi una frase con una richiesta in più ("...e correggila",
// "...e perché fallisce?") non viene mai intercettata e passa a Claude.

import { cleanPrompt } from './text.mjs';

const R = (src) => new RegExp('^' + src + '$', 'i');

// Frammenti riutilizzati negli schemi.
const ART = String.raw`(?:(?:il|la|lo|i|gli|le|un|una|uno|the|a|an)\s+|l'\s?)?`;
const KINDS = String.raw`(?:funzione|function|func|fn|def|classe|class|metodo|method|variabile|variable|var|costante|constant|const|componente|component|tipo|type|interfaccia|interface|hook|enum|struct|struttura|modulo|module|oggetto|object|procedura|selettore|selector|store|endpoint|route|rotta|trait|record|campo|field|proprieta|property|prop|macro|segnale|signal|nodo|node|scena|scene|script|schema|model|modello|tabella|table)`;
const KIND = String.raw`(?:(?<kind>${KINDS})\s+)?`;
const SYM = String.raw`(?<bt>\x60?)(?<sym>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\x60?(?:\(\))?`;
const DEFD = String.raw`(?:\s+(?:definit[oa]|dichiarat[oa]|implementat[oa]|defined|declared|implemented))?`;
const OF = String.raw`(?:(?:di|del|della|dello|dei|degli|delle|of|to|for)\s+|dell'\s?)?`;
const FILE = String.raw`\x60?(?<file>[\w@.\-\/\\]+\.[A-Za-z0-9]{1,10})\x60?`;
const FILEANY = String.raw`\x60?(?<file>[\w@.\-\/\\]+)\x60?`;
const DOVE = String.raw`(?:dov'?\s?e|dove\s+e|dove\s+si\s+trova|dove\s+sta|dove\s+stanno)`;
const WHERE_DEF = String.raw`(?:${DOVE}|dove\s+(?:si\s+)?(?:definisce|dichiara)|dove\s+(?:viene|e\s+stat[oa])\s+(?:definit[oa]|dichiarat[oa]|implementat[oa]|scritt[oa])|dove\s+(?:ho|hai|abbiamo)\s+(?:definito|messo|scritto|dichiarato))`;

const SUBJ_IT = String.raw`(?<subj>i\s+test|il\s+test|test|la\s+build|il\s+build|build|il\s+progetto|progetto|l'\s?app|l'\s?applicazione|app|applicazione|il\s+server\s+di\s+sviluppo|il\s+server|server|il\s+dev\s+server|dev\s+server|lo\s+sviluppo|sviluppo|dev|il\s+linter|il\s+lint|linter|lint|il\s+typecheck|typecheck|il\s+deploy|deploy|la\s+formattazione|il\s+formatter|format|prettier|il\s+sito|sito)`;
const SUBJ_EN = String.raw`(?<subj>(?:the\s+)?(?:tests?|test\s+suite|build|project|app|application|dev\s+server|server|dev|linter|lint|typecheck|type\s+check|deploy|deployment|formatter|format|site|website))`;
const PKG = String.raw`\x60?(?<pkg>@?[A-Za-z0-9][\w.\-]*(?:\/[\w.\-]+)?)\x60?`;

const defs = [
  // ---- Definizione di un simbolo ----
  { intent: 'definition', lang: 'it', re: R(String.raw`${WHERE_DEF}\s+(?:(?:definit[oa]|dichiarat[oa])\s+)?${ART}${KIND}${SYM}${DEFD}`) },
  { intent: 'definition', lang: 'it', re: R(String.raw`(?:in\s+)?(?:che|quale)\s+file\s+(?:si\s+trova|e|sta|c'\s?e|ce|contiene|definisce|dichiara|ha|si\s+definisce|viene\s+definit[oa])\s+${ART}${KIND}${SYM}${DEFD}`) },
  { intent: 'definition', lang: 'it', re: R(String.raw`(?:trova(?:mi)?|cerca(?:mi)?|mostrami|fammi\s+vedere|dammi|vai\s+alla)\s+(?:la\s+)?(?:definizione|dichiarazione)\s+${OF}${ART}${KIND}${SYM}`) },
  { intent: 'definition', lang: 'it', re: R(String.raw`(?:trova(?:mi)?|cerca(?:mi)?|localizza)\s+${ART}(?<kind>${KINDS})\s+${SYM}`) },
  { intent: 'definition', lang: 'it', re: R(String.raw`(?:la\s+)?definizione\s+${OF}${ART}${KIND}${SYM}`) },
  { intent: 'definition', lang: 'en', re: R(String.raw`where(?:'s|\s+is|\s+are|\s+do\s+(?:we|i)\s+define|\s+did\s+(?:we|i|you)\s+define)\s+${ART}${KIND}${SYM}${DEFD}`) },
  { intent: 'definition', lang: 'en', re: R(String.raw`(?:find|locate|show(?:\s+me)?|go\s+to|goto|jump\s+to|get(?:\s+me)?)\s+(?:the\s+)?(?:definition|declaration|source)\s+(?:of|for)\s+${ART}${KIND}${SYM}`) },
  { intent: 'definition', lang: 'en', re: R(String.raw`(?:find|locate)\s+${ART}(?<kind>${KINDS})\s+${SYM}`) },
  { intent: 'definition', lang: 'en', re: R(String.raw`(?:in\s+)?(?:which|what)\s+file\s+(?:is|has|contains|defines|declares)\s+${ART}${KIND}${SYM}${DEFD}`) },
  { intent: 'definition', lang: 'en', re: R(String.raw`(?:the\s+)?definition\s+of\s+${ART}${KIND}${SYM}`) },

  // ---- Dove viene usato un simbolo ----
  { intent: 'usages', lang: 'it', re: R(String.raw`dove\s+(?:viene|vengono|e|sono)\s+(?:usat[oaie]|utilizzat[oaie]|chiamat[oaie]|richiamat[oaie]|importat[oaie]|referenziat[oaie]|invocat[oaie])\s+${ART}${KIND}${SYM}`) },
  { intent: 'usages', lang: 'it', re: R(String.raw`dove\s+(?:si\s+)?(?:usa|utilizza|chiama|richiama|importa|invoca|uso|usiamo|chiamo|chiamiamo|importo|importiamo)\s+${ART}${KIND}${SYM}`) },
  { intent: 'usages', lang: 'it', re: R(String.raw`chi\s+(?:usa|chiama|importa|richiama|utilizza|invoca)\s+${ART}${KIND}${SYM}`) },
  { intent: 'usages', lang: 'it', re: R(String.raw`(?:trova(?:mi)?|cerca(?:mi)?|elenca(?:mi)?|mostrami|dammi|lista)\s+(?:tutti\s+|tutte\s+)?(?:gli\s+|i\s+|le\s+)?(?:usi|utilizzi|riferimenti|chiamate|occorrenze|import)\s+${OF}${ART}${KIND}${SYM}`) },
  { intent: 'usages', lang: 'it', re: R(String.raw`quante\s+volte\s+(?:viene\s+|e\s+)?(?:usat[oa]|utilizzat[oa]|chiamat[oa]|compare|appare|si\s+usa|uso|usiamo)\s+${ART}${KIND}${SYM}`) },
  { intent: 'usages', lang: 'en', re: R(String.raw`where\s+(?:is|are)\s+${ART}${KIND}${SYM}\s+(?:used|called|referenced|imported|invoked)`) },
  { intent: 'usages', lang: 'en', re: R(String.raw`who\s+(?:uses|calls|imports|references|invokes)\s+${ART}${KIND}${SYM}`) },
  { intent: 'usages', lang: 'en', re: R(String.raw`(?:find|show|list|get)(?:\s+me)?\s+(?:all\s+)?(?:the\s+)?(?:usages|uses|references|refs|callers|calls|occurrences|imports)\s+(?:of|to|for)\s+${ART}${KIND}${SYM}`) },
  { intent: 'usages', lang: 'en', re: R(String.raw`(?:usages|references|callers)\s+(?:of|to|for)\s+${ART}${KIND}${SYM}`) },
  { intent: 'usages', lang: 'en', re: R(String.raw`how\s+many\s+times\s+is\s+${ART}${KIND}${SYM}\s+(?:used|called|referenced)`) },

  // ---- Comandi del progetto ----
  { intent: 'scripts', lang: 'it', re: R(String.raw`come\s+(?:(?:si|posso|devo|faccio\s+a|riesco\s+a)\s+)?(?:lancio|lanciare|lancia|lanciano|avvio|avviare|avvia|eseguo|eseguire|esegue|eseguono|faccio\s+partire|far\s+partire|faccio\s+girare|far\s+girare|testo|testare|testa|compilo|compilare|compila|buildo|buildare|builda|faccio|fare|fa|deployo|deployare|formatto|formattare|controllo|controllare)\s+${SUBJ_IT}(?:\s+(?:in\s+locale|localmente|del\s+progetto|qui))?`) },
  { intent: 'scripts', lang: 'it', re: R(String.raw`(?:qual\s?'?\s?e|quale\s+e|quali\s+sono|dimmi|mi\s+dici)\s+(?:il|i|lo|gli)\s+(?:comand[oi]|script)(?:\s+(?:per|da\s+usare\s+per|di)(?:\s+(?:lanciare|avviare|eseguire|far\s+partire|fare|testare|compilare|buildare))?\s+${SUBJ_IT})?(?:\s+(?:del\s+progetto|disponibili))?`) },
  { intent: 'scripts', lang: 'it', re: R(String.raw`(?:quali|che)\s+(?:script|comandi)\s+(?:ci\s+sono|ho|abbiamo|sono\s+disponibili|esistono|posso\s+usare|ha\s+il\s+progetto)`) },
  { intent: 'scripts', lang: 'it', re: R(String.raw`(?:elenca(?:mi)?|mostrami|dammi|lista)\s+(?:gli\s+|i\s+)?(?:script|comandi)(?:\s+(?:del\s+progetto|disponibili|npm))?`) },
  { intent: 'scripts', lang: 'it', re: R(String.raw`(?:script|comandi)\s+(?:disponibili|del\s+progetto|npm)`) },
  { intent: 'scripts', lang: 'en', re: R(String.raw`how\s+(?:do\s+(?:i|we|you)|can\s+(?:i|we)|to|should\s+(?:i|we))\s+(?<verb>run|start|launch|execute|build|test|lint|serve|deploy|compile|format|typecheck)(?:\s+${SUBJ_EN})?(?:\s+(?:locally|here))?`) },
  { intent: 'scripts', lang: 'en', re: R(String.raw`(?:what(?:'s|\s+is|\s+are)|which\s+is|which\s+are|tell\s+me)\s+the\s+(?:(?<verb>test|build|start|dev|run|lint|deploy|format|typecheck)\s+)?(?:commands?|scripts?)(?:\s+(?:to|for)(?:\s+(?:run(?:ning)?|start(?:ing)?|build(?:ing)?|test(?:ing)?))?\s+${SUBJ_EN})?`) },
  { intent: 'scripts', lang: 'en', re: R(String.raw`(?:which|what)\s+(?:scripts|commands)\s+(?:are\s+(?:there|available)|do\s+(?:we|i)\s+have|can\s+i\s+(?:run|use))`) },
  { intent: 'scripts', lang: 'en', re: R(String.raw`(?:list|show)(?:\s+me)?\s+(?:the\s+|all\s+)?(?:npm\s+|available\s+)?(?:scripts|commands)`) },
  { intent: 'scripts', lang: 'en', re: R(String.raw`(?:npm|available|project)\s+scripts`) },

  // ---- Stato di git ----
  { intent: 'status', lang: 'it', re: R(String.raw`(?:cosa|che\s+cosa|che)\s+ho\s+(?:cambiato|modificato|toccato|fatto)(?<when>\s+(?:oggi|finora|fin\s+qui|fino\s+ad\s+ora|ultimamente|nel\s+progetto|nel\s+codice|nei\s+file|dall'\s?ultimo\s+commit))?`) },
  { intent: 'status', lang: 'it', re: R(String.raw`(?:quali|che)\s+file\s+(?:ho|sono\s+stati|sono)\s+(?:modificat[oi]|cambiat[oi]|toccat[oi])(?<when>\s+(?:oggi|finora|nel\s+progetto|dall'\s?ultimo\s+commit))?`) },
  { intent: 'status', lang: 'it', re: R(String.raw`(?:mostrami\s+|fammi\s+vedere\s+|elenca(?:mi)?\s+)?(?:le\s+)?(?:modifiche|cambiamenti)\s+(?:non\s+committate|non\s+salvate|in\s+sospeso|locali|pendenti|non\s+ancora\s+committate)`) },
  { intent: 'status', lang: 'it', re: R(String.raw`ci\s+sono\s+(?:delle\s+|ancora\s+)?modifiche\s+(?:non\s+committate|in\s+sospeso|non\s+salvate|da\s+committare|locali|pendenti)`) },
  { intent: 'status', lang: 'it', re: R(String.raw`(?:git\s+status|stato\s+(?:di\s+git|del\s+repo(?:sitory)?|git)|status\s+(?:del\s+repo|git)|file\s+modificati|modifiche\s+in\s+corso)`) },
  { intent: 'status', lang: 'en', re: R(String.raw`what\s+(?:did\s+i|have\s+i)\s+(?:change|changed|modify|modified|touch|touched|do|done)(?<when>\s+(?:today|so\s+far|since\s+the\s+last\s+commit))?`) },
  { intent: 'status', lang: 'en', re: R(String.raw`(?:which|what)\s+files\s+(?:did\s+i|have\s+i)\s+(?:change|changed|modify|modified|touch|touched)(?<when>\s+(?:today|so\s+far))?`) },
  { intent: 'status', lang: 'en', re: R(String.raw`(?:show|list)(?:\s+me)?\s+(?:my\s+|the\s+)?(?:uncommitted|pending|local|unstaged|current)\s+(?:changes|files|modifications)`) },
  { intent: 'status', lang: 'en', re: R(String.raw`(?:are\s+there\s+(?:any\s+)?|any\s+)uncommitted\s+changes`) },
  { intent: 'status', lang: 'en', re: R(String.raw`(?:git\s+status|repo\s+status|status\s+of\s+the\s+repo)`) },

  // ---- Commit recenti ----
  { intent: 'commits', lang: 'it', re: R(String.raw`(?:mostrami\s+|fammi\s+vedere\s+|elenca(?:mi)?\s+|dammi\s+)?(?:gli\s+|l'\s?)?(?:ultimi|ultimo)\s+(?:(?<n>\d{1,2})\s+)?commit`) },
  { intent: 'commits', lang: 'it', re: R(String.raw`(?:lo\s+)?storico\s+(?:dei\s+|di\s+|del\s+)?(?:commit|git|repo)`) },
  { intent: 'commits', lang: 'it', re: R(String.raw`(?:il\s+)?log\s+(?:dei\s+|di\s+)?(?:commit|git)`) },
  { intent: 'commits', lang: 'it', re: R(String.raw`cosa\s+(?:ho|abbiamo)\s+committato(?<when>\s+(?:oggi|ieri|di\s+recente|ultimamente))?`) },
  { intent: 'commits', lang: 'en', re: R(String.raw`(?:(?:show|list|get)(?:\s+me)?\s+)?(?:the\s+|my\s+)?(?:last|latest|recent)\s+(?:(?<n>\d{1,2})\s+)?commits?`) },
  { intent: 'commits', lang: 'en', re: R(String.raw`(?:git\s+log|commit\s+history|(?:the\s+)?history\s+of\s+commits)`) },
  { intent: 'commits', lang: 'en', re: R(String.raw`what\s+did\s+i\s+commit(?<when>\s+(?:today|yesterday|recently))?`) },

  // ---- Branch ----
  { intent: 'branch', lang: 'it', re: R(String.raw`(?:su|in)\s+(?:che|quale)\s+branch\s+(?:sono|siamo|sto\s+lavorando|stiamo\s+lavorando|lavoro)`) },
  { intent: 'branch', lang: 'it', re: R(String.raw`(?:qual\s?'?\s?e\s+|quale\s+e\s+)?(?:il\s+)?branch\s+(?:corrente|attuale|attivo)`) },
  { intent: 'branch', lang: 'it', re: R(String.raw`(?:che|quale)\s+branch\s+(?:e|e\s+questo|uso|sto\s+usando)`) },
  { intent: 'branches', lang: 'it', re: R(String.raw`(?:quali|che)\s+branch\s+(?:ci\s+sono|ho|abbiamo|esistono)`) },
  { intent: 'branches', lang: 'it', re: R(String.raw`(?:elenca(?:mi)?|mostrami|lista)\s+(?:i\s+|tutti\s+i\s+)?branch`) },
  { intent: 'branch', lang: 'en', re: R(String.raw`(?:what|which)\s+branch\s+(?:am\s+i|are\s+we)\s+(?:on|in|using)`) },
  { intent: 'branch', lang: 'en', re: R(String.raw`(?:what(?:'s|\s+is)\s+)?(?:the\s+)?current\s+branch`) },
  { intent: 'branches', lang: 'en', re: R(String.raw`(?:list|show)(?:\s+me)?\s+(?:all\s+)?(?:the\s+)?(?:local\s+)?branches`) },
  { intent: 'branches', lang: 'en', re: R(String.raw`(?:which|what)\s+branches\s+(?:are\s+there|do\s+(?:we|i)\s+have|exist)`) },

  // ---- TODO e FIXME ----
  { intent: 'todos', lang: 'it', re: R(String.raw`(?:elenca(?:mi)?|mostrami|mostra|trova(?:mi)?|cerca|lista|dammi)\s+(?:tutti\s+)?(?:i\s+|gli\s+)?(?:todo|to-do|fixme)(?:\s+(?:e|o)\s+(?:i\s+)?(?:fixme|todo))?(?:\s+(?:nel\s+progetto|del\s+progetto|nel\s+codice|aperti|rimasti|rimanenti))?`) },
  { intent: 'todos', lang: 'it', re: R(String.raw`(?:quali|quanti)\s+(?:todo|to-do|fixme)\s+(?:ci\s+sono|ho|abbiamo|restano|rimangono|mancano)(?:\s+(?:nel\s+progetto|nel\s+codice))?`) },
  { intent: 'todos', lang: 'it', re: R(String.raw`ci\s+sono\s+(?:dei\s+|ancora\s+|altri\s+)?(?:todo|to-do|fixme)(?:\s+(?:nel\s+progetto|nel\s+codice|aperti))?`) },
  { intent: 'todos', lang: 'en', re: R(String.raw`(?:list|show|find|get)(?:\s+me)?\s+(?:all\s+)?(?:the\s+)?(?:open\s+|remaining\s+)?(?:todos?|to-dos?|fixmes?)(?:\s+(?:and|or)\s+fixmes?)?(?:\s+in\s+(?:the\s+)?(?:project|code|codebase|repo))?`) },
  { intent: 'todos', lang: 'en', re: R(String.raw`(?:are\s+there\s+(?:any\s+)?|any\s+)(?:todos?|fixmes?)(?:\s+left)?(?:\s+in\s+(?:the\s+)?(?:project|code|codebase))?`) },
  { intent: 'todos', lang: 'en', re: R(String.raw`how\s+many\s+(?:todos?|fixmes?)(?:\s+(?:are\s+there|do\s+we\s+have|left))?`) },

  // ---- Versioni ----
  { intent: 'version', lang: 'it', re: R(String.raw`(?:che|quale)\s+versione\s+(?:di|del|della|dello|dei|dell'\s?)\s*${PKG}(?:\s+(?:uso|usiamo|ho|abbiamo|c'\s?e|ce|e\s+installat[oa]|stiamo\s+usando|sto\s+usando|e\s+in\s+uso|e|nel\s+progetto|abbiamo\s+installato|ho\s+installato))?`) },
  { intent: 'version', lang: 'it', re: R(String.raw`versione\s+(?:di|del|della|dello|dell'\s?)\s*${PKG}(?:\s+(?:installata|in\s+uso|nel\s+progetto))?`) },
  { intent: 'version', lang: 'en', re: R(String.raw`(?:what|which)\s+version\s+of\s+${PKG}(?:\s+(?:am\s+i|are\s+we|is|do\s+(?:we|i))(?:\s+(?:using|installed|have|use|on))?)?(?:\s+installed)?`) },
  { intent: 'version', lang: 'en', re: R(String.raw`(?:the\s+)?installed\s+version\s+of\s+${PKG}`) },

  // ---- Consumo di token ----
  { intent: 'tokens', lang: 'it', re: R(String.raw`quanti\s+token(?:\s+(?:ho|abbiamo|sto|stiamo|sono\s+stati))?(?:\s+(?:usato|usati|consumato|consumati|speso|spesi|usando|consumando|utilizzato|utilizzati))?(?:\s+(?:finora|in\s+questa\s+sessione|nella\s+sessione|oggi))?`) },
  { intent: 'tokens', lang: 'it', re: R(String.raw`quanto\s+(?:ho|abbiamo)\s+(?:speso|consumato|usato)(?:\s+(?:finora|in\s+questa\s+sessione|oggi))?`) },
  { intent: 'tokens', lang: 'it', re: R(String.raw`quanto\s+(?:e|pesa|e\s+grande|e\s+pieno|occupa)\s+(?:il\s+)?contesto`) },
  { intent: 'tokens', lang: 'it', re: R(String.raw`(?:la\s+)?(?:dimensione|grandezza)\s+del\s+contesto|(?:consumo|uso|utilizzo)\s+(?:di\s+|dei\s+)?token(?:\s+(?:della\s+sessione|di\s+questa\s+sessione))?|quanto\s+costa\s+questa\s+sessione`) },
  { intent: 'tokens', lang: 'en', re: R(String.raw`how\s+many\s+tokens(?:\s+(?:have\s+i|did\s+i|am\s+i|have\s+we|did\s+we|has\s+this\s+session))?(?:\s+(?:used|spent|consumed|using|use|spend))?(?:\s+(?:so\s+far|in\s+this\s+session|today))?`) },
  { intent: 'tokens', lang: 'en', re: R(String.raw`(?:token|context)\s+(?:usage|size)|how\s+(?:big|large|full)\s+is\s+(?:the\s+|my\s+)?context|how\s+much\s+(?:have\s+i|did\s+i|has\s+this\s+session)\s+(?:spent|used|cost)(?:\s+so\s+far)?`) },

  // ---- Struttura del progetto ----
  { intent: 'tree', lang: 'it', re: R(String.raw`(?:mostrami\s+|dammi\s+|fammi\s+vedere\s+)?(?:la\s+)?struttura\s+(?:del\s+progetto|del\s+repo(?:sitory)?|delle\s+cartelle|dei\s+file|della\s+cartella)`) },
  { intent: 'tree', lang: 'it', re: R(String.raw`(?:mostrami\s+|dammi\s+)?(?:l'\s?)?albero\s+(?:del\s+progetto|dei\s+file|delle\s+cartelle|del\s+repo)`) },
  { intent: 'tree', lang: 'it', re: R(String.raw`(?:elenca(?:mi)?|mostrami|lista|dammi)\s+(?:tutti\s+)?(?:i\s+)?file\s+(?:del\s+progetto|del\s+repo|nel\s+progetto)`) },
  { intent: 'tree', lang: 'en', re: R(String.raw`(?:(?:show|give)(?:\s+me)?\s+)?(?:the\s+)?(?:project|folder|directory|repo|file)\s+(?:structure|tree|layout)`) },
  { intent: 'tree', lang: 'en', re: R(String.raw`list\s+(?:all\s+)?(?:the\s+)?(?:project\s+)?files(?:\s+in\s+(?:the\s+)?(?:project|repo))?`) },
];

// Schemi che dipendono dall'esistenza di un file: vengono provati per primi,
// ma valgono solo se il file esiste davvero (lo verifica chi risponde).
const fileDefs = [
  { intent: 'findfile', lang: 'it', re: R(String.raw`(?:${DOVE}|in\s+(?:che|quale)\s+cartella\s+(?:e|si\s+trova|sta))\s+(?:il\s+)?(?:file\s+)?${FILE}`) },
  { intent: 'findfile', lang: 'it', re: R(String.raw`(?:trova(?:mi)?|cerca(?:mi)?|localizza)\s+(?:il\s+)?file\s+${FILEANY}`) },
  { intent: 'findfile', lang: 'en', re: R(String.raw`where(?:'s|\s+is)\s+(?:the\s+)?(?:file\s+)?${FILE}`) },
  { intent: 'findfile', lang: 'en', re: R(String.raw`(?:find|locate)\s+(?:the\s+)?file\s+${FILEANY}`) },
  { intent: 'showfile', lang: 'it', re: R(String.raw`(?:mostrami|mostra|fammi\s+vedere|apri|aprimi|stampa|stampami|visualizza|leggimi)\s+(?:il\s+)?(?:file\s+|contenuto\s+(?:di|del|dello|della)\s+(?:file\s+)?|contenuto\s+dell'\s?(?:file\s+)?)?${FILEANY}`) },
  { intent: 'showfile', lang: 'en', re: R(String.raw`(?:show|print|cat|open|display|read)(?:\s+me)?\s+(?:the\s+)?(?:file\s+|contents?\s+of\s+(?:the\s+)?(?:file\s+)?)?${FILEANY}`) },
];

const STOP = new Set(['che', 'chi', 'cosa', 'come', 'quale', 'quali', 'questo', 'questa', 'quello', 'quella', 'bug', 'errore', 'problema', 'codice', 'file', 'progetto', 'it', 'this', 'that', 'the', 'what', 'which', 'error', 'problem', 'code', 'project', 'thing', 'cosa', 'roba', 'logica', 'logic']);

// Un nome "sembra codice" se l'utente lo ha messo tra backtick, se ha indicato
// il tipo (funzione, classe...) oppure se ha la forma tipica di un identificatore.
export function looksLikeCode(sym, { bt, kind, forced } = {}) {
  if (!sym || STOP.has(sym.toLowerCase())) return Boolean(bt);
  if (forced || bt || kind) return true;
  if (/[_$\d]/.test(sym) || sym.includes('.')) return true;
  if (/[a-z][A-Z]/.test(sym)) return true;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(sym)) return true;
  return false;
}

// Restituisce { intent, lang, params } oppure null.
export function detect(prompt, { forced = false } = {}) {
  const text = cleanPrompt(prompt);
  if (!text || text.length > 160) return null;
  const candidates = [];
  for (const d of fileDefs) {
    const m = d.re.exec(text);
    if (m) candidates.push({ intent: d.intent, lang: d.lang, params: { file: m.groups.file.replace(/\\/g, '/') }, needsFile: true });
  }
  for (const d of defs) {
    const m = d.re.exec(text);
    if (!m) continue;
    const g = m.groups || {};
    if (d.intent === 'definition' || d.intent === 'usages') {
      if (!looksLikeCode(g.sym, { bt: g.bt, kind: g.kind, forced })) continue;
      candidates.push({ intent: d.intent, lang: d.lang, params: { sym: g.sym, kind: g.kind || null } });
    } else {
      const params = {};
      if (g.subj) params.subj = g.subj;
      if (g.verb) params.verb = g.verb;
      if (g.when) params.when = g.when.trim();
      if (g.n) params.n = Number(g.n);
      if (g.pkg) params.pkg = g.pkg;
      if (d.intent === 'tokens' || d.intent === 'tree') params.text = text;
      candidates.push({ intent: d.intent, lang: d.lang, params });
    }
    break;
  }
  return candidates.length ? candidates : null;
}
