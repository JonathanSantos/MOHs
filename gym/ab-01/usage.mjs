// Registra o uso de um subagente: node usage.mjs <run> <tokens> <tools> <ms> <decisões> "<resumo>"
import { readFileSync, writeFileSync } from "node:fs";
const file = new URL("usage.json", import.meta.url);
const [run, tokens, tools, ms, decisions, note] = process.argv.slice(2);
const usage = JSON.parse(readFileSync(file, "utf8"));
usage[run] = { tokens: +tokens, tools: +tools, ms: +ms, decisions: +decisions, note };
writeFileSync(file, JSON.stringify(usage, null, 2));
