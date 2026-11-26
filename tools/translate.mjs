#!/usr/bin/env node
// npm run translate [-- --json out.json] [--bare]
//
// What each language still needs (src/i18n/index.ts, tools/translate/lines.ts): lines missing from
// src/i18n/locales/<lang>.json, lines there that English no longer has, and (--bare) English in the
// interface that skips t(). With --json, writes { lang: { line: "" | { one, other } } } of the missing
// lines, to fill in and merge by hand or with --merge.
//
// npm run translate -- --merge filled.json   adds filled lines into each language file (and drops stale ones).
// npm run translate -- --tidy                rewrites the language files in source order (stable diffs).

import fs from 'node:fs';
import path from 'node:path';
import { loadModule, parseArgs } from './lib/vite.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const loaded = await loadModule('/tools/translate/lines.ts');
const { allLines, scan, readLocale, LOCALES, LANGS } = loaded.mod;
const lines = allLines();
const keys = new Set(lines.map((l) => l.key));
const others = LANGS.filter((l) => l !== 'en');

const write = (lang, table) => {
  const ordered = {};
  for (const l of lines) if (l.key in table) ordered[l.key] = table[l.key];
  fs.writeFileSync(path.join(LOCALES, `${lang}.json`), JSON.stringify(ordered, null, 2) + '\n');
};

if (flags.merge) {
  const filled = JSON.parse(fs.readFileSync(String(flags.merge), 'utf8'));
  for (const lang of others) {
    const table = { ...readLocale(lang), ...(filled[lang] ?? {}) };
    for (const k of Object.keys(table)) if (!keys.has(k) || table[k] === '') delete table[k];
    write(lang, table);
  }
}
if (flags.tidy) for (const lang of others) write(lang, readLocale(lang));

const todo = {};
for (const lang of others) {
  const table = readLocale(lang);
  const missing = lines.filter((l) => !(l.key in table));
  const stale = Object.keys(table).filter((k) => !keys.has(k));
  todo[lang] = Object.fromEntries(missing.map((l) => [l.key, l.plural ? Object.fromEntries(Object.keys(l.plural).map((f) => [f, ''])) : '']));
  console.log(`${lang}: ${missing.length} missing, ${stale.length} stale${stale.length ? `\n  stale: ${stale.slice(0, 10).join(' | ')}` : ''}`);
}
console.log(`${lines.length} lines in all.`);
if (flags.bare) {
  const { bare } = scan();
  for (const b of bare) console.log(`bare  ${b.where}  ${b.text}`);
  console.log(`${bare.length} bare.`);
}
if (flags.json) fs.writeFileSync(String(flags.json), JSON.stringify(todo, null, 2) + '\n');
await loaded.close();
