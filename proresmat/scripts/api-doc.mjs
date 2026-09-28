// Generates docs/API.md from the engine's action registry so the API reference never drifts.
import { writeFile } from 'node:fs/promises';
import { createEngine } from '../core/engine.js';

const eng = await createEngine({ store: { load: async () => null, save: async () => {} }, blobs: { put: async () => {}, get: async () => null, del: async () => {} }, config: { demo: true, docKey: '00'.repeat(32) } });
const acts = Object.values(eng.internals).length ? eng.actions() : [];
const groups = {};
for (const a of acts) (groups[a.name.split('.')[0]] ||= []).push(a);
let md = `# PRORESMAT API v1\n\nBase path \`/api/v1\`. JSON in, JSON out: success is \`{ "data": … }\`, failure is \`{ "error": { "code", "message", "details" } }\` with a matching HTTP status.\nAuthenticate with \`Authorization: Bearer <token>\` from \`POST /auth/login\` (or \`/auth/mfa\` for privileged roles).\nMoney is in pesewas (integer). Times are ISO 8601 UTC (Ghana time).\n\nGenerated from \`core/\` by \`node scripts/api-doc.mjs\`.\n`;
for (const [g, list] of Object.entries(groups)) {
  md += `\n## ${g}\n\n| Action | Method | Path | Auth |\n|---|---|---|---|\n`;
  for (const a of list) md += `| \`${a.name}\` | ${a.method} | \`${a.path}\` | ${a.auth ? 'Bearer' : 'Public'} |\n`;
}
await writeFile(new URL('../docs/API.md', import.meta.url), md);
console.log(`Wrote docs/API.md (${acts.length} endpoints)`);
