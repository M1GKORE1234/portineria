// Crea un piccolo progetto di prova (git) su cui far girare la Portineria.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const files = {
  '.gitignore': 'node_modules\n',
  'package.json': JSON.stringify({
    name: 'demo-app',
    scripts: { dev: 'vite', build: 'vite build', test: 'vitest run', 'test:e2e': 'playwright test', lint: 'eslint .' },
    dependencies: { react: '^18.2.0' },
    devDependencies: { typescript: '^5.4.0' },
  }, null, 2),
  'package-lock.json': '{}',
  'node_modules/react/package.json': JSON.stringify({ name: 'react', version: '18.3.1' }),
  'src/utils/user.ts': [
    'export interface User { id: number; name: string }',
    '',
    'export function parseUser(raw: string): User {',
    '  // TODO: handle timezone in createdAt',
    '  return JSON.parse(raw);',
    '}',
    '',
    'export const formatDate = (d: Date) => d.toISOString();',
    '',
  ].join('\n'),
  'src/components/UserCard.tsx': [
    "import { parseUser, formatDate } from '../utils/user';",
    '',
    'export class UserCard extends Component {',
    '  render() {',
    '    const u = parseUser(this.props.raw);',
    '    return formatDate(new Date());',
    '  }',
    '}',
    '',
  ].join('\n'),
  'src/api/users.ts': [
    "import { parseUser } from '../utils/user';",
    '',
    'export async function loadUsers(list: string[]) {',
    '  // FIXME: retry on network errors',
    '  return list.map((raw) => parseUser(raw));',
    '}',
    '',
  ].join('\n'),
  'server/app.py': [
    'MAX_USERS = 100',
    '',
    'class Config:',
    '    debug = False',
    '',
    'def create_app():',
    '    return Config()',
    '',
  ].join('\n'),
  'go/main.go': 'package main\n\nfunc HandleLogin(w int, r int) {}\n',
  'config/config.json': '{ "port": 3000 }\n',
  'Makefile': 'build:\n\tnpm run build\n\ndeploy: build\n\t./deploy.sh\n',
  'README.md': '# Demo\n',
};

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

export function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portineria-demo-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.name', 'Test');
  sh(dir, 'config', 'user.email', 'test@example.invalid');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'Primo commit');
  fs.appendFileSync(path.join(dir, 'src/api/users.ts'), 'export const PAGE_SIZE = 20;\n');
  sh(dir, 'commit', '-q', '-am', 'Aggiunge PAGE_SIZE');
  // Modifiche non committate:
  fs.appendFileSync(path.join(dir, 'src/api/users.ts'), 'export const RETRIES = 3;\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'appunti\n');

  // Trascrizione finta della sessione: ultimo contesto = 152.300 token.
  const transcript = path.join(dir, '..', `${path.basename(dir)}.jsonl`);
  const lines = [
    { type: 'user', message: { role: 'user', content: 'ciao' } },
    { type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_creation_input_tokens: 20000, cache_read_input_tokens: 100000, output_tokens: 800 } } },
    { type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_creation_input_tokens: 20000, cache_read_input_tokens: 100000, output_tokens: 900 } } },
    { type: 'assistant', isSidechain: true, message: { id: 's1', model: 'claude-haiku-5-5', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 9000, output_tokens: 100 } } },
    { type: 'assistant', message: { id: 'm2', model: 'claude-opus-5-5', usage: { input_tokens: 300, cache_creation_input_tokens: 2000, cache_read_input_tokens: 150000, output_tokens: 1200 } } },
  ];
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, transcript };
}
