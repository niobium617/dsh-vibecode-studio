#!/usr/bin/env node
// Read-only Claude Code usage report for this repository's sessions.
//
// Usage:
//   node tools/cc-usage.mjs [--dir <claude-project-dir>] [--limit N | --all] [--json]
//
// Defaults to ~/.claude/projects/<sanitized-repo-path>. It only reads JSONL
// transcripts; it never writes or deletes anything.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `Read-only Claude Code usage report.

Usage:
  node tools/cc-usage.mjs [options]

Options:
  --dir <path>   Claude project transcript directory (default: derived from repo path)
  --limit <n>    Number of main sessions to show (default: 8; 0 = all)
  --all          Show all main sessions
  --json         Print machine-readable JSON
  -h, --help     Show this help

The report separates main sessions from subagent transcripts and summarizes
uncached input, cache reads, output, tool calls, tool-result bytes, and
compactions. Use output + uncached input as the billable proxy, not total input.`;

const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);

function valueOf(flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const value = argv[i + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${flag} requires a value`);
    process.exit(2);
  }
  return value;
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(HELP);
  process.exit(0);
}

const jsonMode = hasFlag('--json');
const dirArg = valueOf('--dir');
const limitArg = valueOf('--limit');
const showAll = hasFlag('--all');
const limit = showAll ? 0 : limitArg === null ? 8 : Number(limitArg);

if (limitArg !== null && (!Number.isInteger(limit) || limit < 0)) {
  console.error('--limit must be a non-negative integer');
  process.exit(2);
}

function resolveProjectDir() {
  if (dirArg) {
    const resolved = path.resolve(dirArg);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      console.error(`Not a directory: ${resolved}`);
      process.exit(1);
    }
    return resolved;
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  const slug = repoRoot.replace(/[:\\/]/g, '-').replace(/_/g, '-');
  const direct = path.join(projectsRoot, slug);
  if (fs.existsSync(direct)) return direct;

  const base = path.basename(repoRoot).replace(/_/g, '-').toLowerCase();
  if (fs.existsSync(projectsRoot)) {
    const match = fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().endsWith(base))
      .map((entry) => path.join(projectsRoot, entry.name))[0];
    if (match) return match;
  }

  console.error(`Could not find a Claude project directory for ${repoRoot}.`);
  console.error('Pass --dir <path> explicitly.');
  process.exit(1);
}

function walkJsonl(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkJsonl(full));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
  }
  return files;
}

function emptyAggregate() {
  return {
    assistant: 0,
    models: new Map(),
    input: 0,
    cacheRead: 0,
    cacheCreate: 0,
    output: 0,
    tools: new Map(),
    toolChars: 0,
    charsByTool: new Map(),
    compactions: 0,
    first: null,
    last: null,
  };
}

function contentLength(value) {
  if (typeof value === 'string') return value.length;
  if (!Array.isArray(value)) return 0;
  return value.reduce(
    (total, block) => total + (typeof block?.text === 'string' ? block.text.length : 0),
    0,
  );
}

function parseFile(file) {
  const agg = emptyAggregate();
  const toolNames = new Map();
  const text = fs.readFileSync(file, 'utf8');

  for (const line of text.split(/\r?\n/)) {
    if (!line || line[0] !== '{') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = entry.timestamp || entry.message?.timestamp || null;
    if (timestamp) {
      if (!agg.first || timestamp < agg.first) agg.first = timestamp;
      if (!agg.last || timestamp > agg.last) agg.last = timestamp;
    }

    if (entry.type === 'assistant') {
      const message = entry.message || {};
      const usage = message.usage || entry.usage || {};
      agg.assistant += 1;

      const model = message.model || entry.model || 'unknown';
      agg.models.set(model, (agg.models.get(model) || 0) + 1);

      agg.input += usage.input_tokens || 0;
      agg.cacheRead += usage.cache_read_input_tokens || 0;
      agg.cacheCreate += usage.cache_creation_input_tokens || 0;
      agg.output += usage.output_tokens || 0;

      for (const block of message.content || []) {
        if (!block || block.type !== 'tool_use') continue;
        const name = block.name || 'unknown';
        agg.tools.set(name, (agg.tools.get(name) || 0) + 1);
        if (block.id) toolNames.set(block.id, name);
      }
    } else if (entry.type === 'user') {
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || block.type !== 'tool_result') continue;
        const length = contentLength(block.content);
        const name = toolNames.get(block.tool_use_id) || 'unknown';
        agg.toolChars += length;
        agg.charsByTool.set(name, (agg.charsByTool.get(name) || 0) + length);
      }
    } else if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      agg.compactions += 1;
    }
  }

  return agg;
}

function sumInto(target, source) {
  target.assistant += source.assistant;
  target.input += source.input;
  target.cacheRead += source.cacheRead;
  target.cacheCreate += source.cacheCreate;
  target.output += source.output;
  target.toolChars += source.toolChars;
  target.compactions += source.compactions;
  if (source.first && (!target.first || source.first < target.first)) target.first = source.first;
  if (source.last && (!target.last || source.last > target.last)) target.last = source.last;
  for (const [key, value] of source.models) target.models.set(key, (target.models.get(key) || 0) + value);
  for (const [key, value] of source.tools) target.tools.set(key, (target.tools.get(key) || 0) + value);
  for (const [key, value] of source.charsByTool) target.charsByTool.set(key, (target.charsByTool.get(key) || 0) + value);
}

const numberFormat = new Intl.NumberFormat('en-US');

function fmt(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return numberFormat.format(value);
}

function shortModel(model) {
  if (/pro/i.test(model)) return 'pro';
  if (/flash/i.test(model)) return 'flash';
  return model.length > 10 ? `${model.slice(0, 9)}…` : model;
}

function modelSummary(models) {
  const entries = [...models.entries()].sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([model]) => shortModel(model)).join(',') : '-';
}

function topTools(agg, count = 6) {
  return [...agg.tools.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name, calls]) => ({ name, calls, chars: agg.charsByTool.get(name) || 0 }));
}

function formatLast(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16);
}

function uncached(agg) {
  return agg.input + agg.cacheCreate;
}

function cacheRate(agg) {
  const totalInput = uncached(agg) + agg.cacheRead;
  return totalInput ? (agg.cacheRead / totalInput) * 100 : 0;
}

function sessionRecord(entry) {
  const agg = entry.agg;
  return {
    session: path.basename(entry.file, '.jsonl'),
    last: entry.agg.last,
    models: modelSummary(agg.models),
    assistant: agg.assistant,
    uncached: uncached(agg),
    cacheRead: agg.cacheRead,
    cachePercent: Number(cacheRate(agg).toFixed(1)),
    output: agg.output,
    compactions: agg.compactions,
    toolCalls: [...agg.tools.values()].reduce((sum, value) => sum + value, 0),
    toolChars: agg.toolChars,
    size: entry.size,
    topTools: topTools(agg),
  };
}

function aggregateRecord(agg) {
  return {
    assistant: agg.assistant,
    uncached: uncached(agg),
    cacheRead: agg.cacheRead,
    cachePercent: Number(cacheRate(agg).toFixed(1)),
    output: agg.output,
    compactions: agg.compactions,
    toolCalls: [...agg.tools.values()].reduce((sum, value) => sum + value, 0),
    toolChars: agg.toolChars,
    topTools: topTools(agg, 8),
  };
}

const projectDir = resolveProjectDir();
const entries = walkJsonl(projectDir).map((file) => {
  const stat = fs.statSync(file);
  const relative = path.relative(projectDir, file);
  const isSubagent = relative.split(path.sep).includes('subagents');
  return { file, relative, isSubagent, size: stat.size, mtime: stat.mtimeMs, agg: parseFile(file) };
});

const mainEntries = entries
  .filter((entry) => !entry.isSubagent)
  .sort((a, b) => b.mtime - a.mtime);
const subagentEntries = entries.filter((entry) => entry.isSubagent);

const mainAgg = emptyAggregate();
const subagentAgg = emptyAggregate();
for (const entry of mainEntries) sumInto(mainAgg, entry.agg);
for (const entry of subagentEntries) sumInto(subagentAgg, entry.agg);

const allAgg = emptyAggregate();
sumInto(allAgg, mainAgg);
sumInto(allAgg, subagentAgg);

const shown = limit === 0 ? mainEntries : mainEntries.slice(0, limit);
const records = shown.map(sessionRecord);

if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        projectDir,
        generatedAt: new Date().toISOString(),
        main: records,
        subagents: {
          files: subagentEntries.length,
          ...aggregateRecord(subagentAgg),
        },
        totals: {
          files: entries.length,
          mainFiles: mainEntries.length,
          subagentFiles: subagentEntries.length,
          ...aggregateRecord(allAgg),
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`Claude usage — ${projectDir}`);
console.log(`Sessions: ${mainEntries.length} main, ${subagentEntries.length} subagent file(s)`);
console.log('');

if (!records.length) {
  console.log('No JSONL transcripts found.');
  process.exit(0);
}

const header = [
  'SESSION'.padEnd(14),
  'LAST'.padEnd(17),
  'MODEL'.padEnd(8),
  'MSGS'.padStart(6),
  'UNCACHED'.padStart(10),
  'CACHE%'.padStart(8),
  'OUTPUT'.padStart(9),
  'COMP'.padStart(6),
  'TOOLS'.padStart(6),
].join(' ');
console.log(header);
console.log('-'.repeat(header.length));

for (const record of records) {
  console.log(
    [
      record.session.slice(0, 14).padEnd(14),
      formatLast(record.last).padEnd(17),
      record.models.padEnd(8),
      String(record.assistant).padStart(6),
      fmt(record.uncached).padStart(10),
      `${record.cachePercent.toFixed(1)}%`.padStart(8),
      fmt(record.output).padStart(9),
      String(record.compactions).padStart(6),
      fmt(record.toolCalls).padStart(6),
    ].join(' '),
  );
}

console.log('');
console.log('Main totals');
console.log(`  messages=${numberFormat.format(mainAgg.assistant)}  uncached=${fmt(uncached(mainAgg))}  cache_read=${fmt(mainAgg.cacheRead)}  output=${fmt(mainAgg.output)}  compactions=${mainAgg.compactions}  tool_calls=${numberFormat.format([...mainAgg.tools.values()].reduce((sum, value) => sum + value, 0))}`);

console.log('');
console.log('Subagents');
console.log(`  files=${subagentEntries.length}  messages=${numberFormat.format(subagentAgg.assistant)}  uncached=${fmt(uncached(subagentAgg))}  cache_read=${fmt(subagentAgg.cacheRead)}  output=${fmt(subagentAgg.output)}  compactions=${subagentAgg.compactions}`);
if (subagentEntries.length) {
  for (const tool of topTools(subagentAgg, 5)) {
    console.log(`  ${tool.name}: ${numberFormat.format(tool.calls)} calls, ${fmt(tool.chars)} result chars`);
  }
}

console.log('');
console.log('All totals');
console.log(`  billable proxy (uncached + output) = ${fmt(uncached(allAgg) + allAgg.output)}`);
console.log(`  cache_read = ${fmt(allAgg.cacheRead)} (cheap; do not optimize this number first)`);
console.log(`  tool_result_chars = ${fmt(allAgg.toolChars)}`);
console.log('');
console.log('Top tools (all transcripts)');
for (const tool of topTools(allAgg, 8)) {
  console.log(`  ${tool.name}: ${numberFormat.format(tool.calls)} calls, ${fmt(tool.chars)} result chars`);
}
