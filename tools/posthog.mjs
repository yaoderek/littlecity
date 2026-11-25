#!/usr/bin/env node
/* global fetch */
// node tools/posthog.mjs [--days 14] [--query "select ..."] [--json out.json]
//
// What players do, from PostHog (src/app/analytics.ts has the list of events). Read only: it runs HogQL
// queries and prints the answers as tables. Needs a PERSONAL API key (phx_…, scopes: Query read and
// Project read), which is secret, unlike the project key in .env.production. It is read from
// POSTHOG_PERSONAL_API_KEY or from the file ~/.config/littlecity/posthog-key, and never printed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from './lib/vite.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const days = Math.max(1, Number(flags.days ?? 14) | 0);
const HOST = process.env.POSTHOG_HOST ?? 'https://us.posthog.com';
const file = path.join(os.homedir(), '.config/littlecity/posthog-key');
const KEY = (process.env.POSTHOG_PERSONAL_API_KEY ?? (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')).trim();
if (!KEY) {
  console.error(`No PostHog key. Make one at ${HOST}/settings/user-api-keys (scopes: Query read, Project read) and put it in ${file}`);
  process.exit(1);
}

async function ask(query) {
  const r = await fetch(`${HOST}/api/projects/${process.env.POSTHOG_PROJECT ?? '@current'}/query/`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!r.ok) throw new Error(`PostHog said ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const { columns, results } = await r.json();
  return { columns, rows: results };
}

const since = `timestamp > now() - interval ${days} day`;
const here = `${since} and properties.$host = 'littlecity.io'`;
const QUERIES = {
  'Visitors by day': `select toDate(timestamp) as d, uniq(person_id) as people, uniqIf(person_id, properties.touch = true) as on_touch, countIf(event = '$pageview') as views from events where ${here} group by d order by d`,
  'Where they came from': `select coalesce(properties.$referring_domain, '') source, uniq(person_id) people from events where ${here} and event = '$pageview' group by source order by people desc limit 15`,
  'How far they got (people)': `select uniqIf(person_id, event = 'town_opened') opened, uniqIf(person_id, event = 'playtime') played_at_all, uniqIf(person_id, event = 'playtime' and toFloat(properties.uses) > 0) built_something, uniqIf(person_id, event = 'building_earned' and properties.grown = false) earned_a_building, uniqIf(person_id, event = 'guide_opened') opened_guide, uniqIf(person_id, event = 'town_grown') grew_a_town, uniqIf(person_id, event = 'fly_started') flew, uniqIf(person_id, event in ('town_shared', 'postcard_saved')) shared_or_postcard from events where ${here}`,
  'Minutes played per person': `select multiIf(s < 30, 'a: under 30 s', s < 120, 'b: 30 s to 2 min', s < 600, 'c: 2 to 10 min', s < 1800, 'd: 10 to 30 min', 'e: over 30 min') played, count() people, round(avg(uses), 1) avg_pieces from (select person_id, coalesce(sumIf(toFloat(properties.seconds), event = 'playtime'), 0) s, coalesce(sumIf(toFloat(properties.uses), event = 'playtime'), 0) uses from events where ${here} group by person_id) group by played order by played`,
  'People who came back on another day': `select days_seen, count() people from (select person_id, uniq(toDate(timestamp)) days_seen from events where ${here} and event = 'playtime' group by person_id) group by days_seen order by days_seen`,
  'What they use': `select k item, round(sum(toFloat(JSONExtractRaw(properties, k)))) times, uniq(person_id) people from (select person_id, properties, arrayJoin(JSONExtractKeys(properties)) k from events where ${here} and event = 'playtime') where startsWith(k, 'use_') or startsWith(k, 'mischief_') or k in ('erased', 'undo') group by k order by times desc limit 40`,
  'Buildings earned by hand': `select properties.role role, uniq(person_id) people from events where ${here} and event = 'building_earned' and properties.grown = false group by role order by people desc limit 25`,
  'Signs of confusion: what was refused': `select properties.reason reason, count() times, uniq(person_id) people from events where ${here} and event = 'piece_refused' group by reason order by people desc limit 20`,
  'Signs of confusion: rage clicks': `select coalesce(elements_chain, '') what, count() times, uniq(person_id) people from events where ${here} and event = '$rageclick' group by what order by people desc limit 10`,
  'Seconds to the first piece': `select count() n, quantile(0.5)(toFloat(properties.seconds)) median, quantile(0.9)(toFloat(properties.seconds)) p90 from events where ${here} and event = 'first_build'`,
  'Slowness by system (web vitals, ms)': `select properties.$os os, properties.$browser browser, uniq(person_id) people, round(quantile(0.5)(toFloat(properties.$web_vitals_INP_value))) inp_p50, round(quantile(0.9)(toFloat(properties.$web_vitals_INP_value))) inp_p90, round(quantile(0.5)(toFloat(properties.$web_vitals_LCP_value))) lcp_p50, round(quantile(0.9)(toFloat(properties.$web_vitals_LCP_value))) lcp_p90 from events where ${here} and event = '$web_vitals' group by os, browser order by people desc limit 20`,
  'Do slow ones leave sooner? (median seconds played by tap delay)': `select multiIf(inp < 200, 'a: under 200 ms', inp < 500, 'b: 200 to 500', inp < 1500, 'c: 500 to 1500', 'd: over 1500') tap_delay, count() people, round(quantile(0.5)(s)) median_seconds from (select person_id, maxIf(toFloat(properties.$web_vitals_INP_value), event = '$web_vitals') inp, coalesce(sumIf(toFloat(properties.seconds), event = 'playtime'), 0) s from events where ${here} group by person_id having inp > 0) group by tap_delay order by tap_delay`,
  'Frames by graphics chip': `select properties.gpu gpu, uniq(person_id) people, round(quantile(0.5)(toFloat(properties.fps))) fps_p50, round(quantile(0.1)(toFloat(properties.fps))) fps_p10, round(avg(toFloat(properties.long_frames))) long_pct, round(avg(toFloat(properties.quality)), 1) level from events where ${here} and event = 'playtime' and toFloat(properties.fps) > 0 group by gpu order by people desc limit 30`,
  'Errors': `select event, coalesce(toString(properties.$exception_types), '') what, count() times, uniq(person_id) people from events where ${here} and event = '$exception' group by event, what order by people desc limit 10`,
};

const all = {};
for (const [title, q] of Object.entries(flags.query ? { Answer: String(flags.query) } : QUERIES)) {
  console.log(`\n${title}`);
  try {
    const { columns, rows } = await ask(q);
    all[title] = { columns, rows };
    if (!rows.length) console.log('  (nothing)');
    const text = [columns, ...rows].map((r) => r.map((v) => (v === null ? '-' : String(v)).slice(0, 60)));
    const w = columns.map((_, i) => Math.max(...text.map((r) => r[i].length)));
    for (const r of rows.length ? text : []) console.log('  ' + r.map((v, i) => v.padEnd(w[i])).join('  '));
  } catch (e) {
    console.log(`  could not be asked: ${e.message}`);
  }
}
if (flags.json) fs.writeFileSync(String(flags.json), JSON.stringify(all, null, 2));
