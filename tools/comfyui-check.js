#!/usr/bin/env node
'use strict';

/**
 * Mystic Witch Live — ComfyUI connectivity check.
 *
 * Verifies the three things Phase 1.5 asks for and nothing more:
 *   1. GET  /system_stats  (server identity, version, RAM)
 *   2. GET  /queue         (pollable queue state)
 *   3. WS   /ws?clientId   (event socket answers with a message)
 *
 * Usage:
 *   node tools/comfyui-check.js
 *   node tools/comfyui-check.js --url=http://10.0.0.142:8188 --json
 *
 * Exit code 0 = all three checks passed, 1 = at least one failed.
 */

const { ComfyUIClient, DEFAULT_BASE_URL } = require('../comfyui-client');

function parseArgs(argv) {
  const options = { baseUrl: process.env.COMFYUI_BASE_URL || DEFAULT_BASE_URL, json: false, timeoutMs: undefined };
  for (const arg of argv.slice(2)) {
    if (arg === '--json') options.json = true;
    else if (arg.startsWith('--url=')) options.baseUrl = arg.slice('--url='.length);
    else if (arg.startsWith('--timeout=')) options.timeoutMs = Number.parseInt(arg.slice('--timeout='.length), 10);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      options.help = true;
    }
  }
  return options;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'n/a';
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

function printReport(report) {
  const line = (ok) => (ok ? 'PASS' : 'FAIL');
  console.log('============================================================');
  console.log(`🔮 ComfyUI connectivity check — ${report.baseUrl}`);
  console.log('============================================================');
  console.log(`[${line(report.systemStats.ok)}] system_stats`);
  if (report.systemStats.ok) {
    console.log(`        version: ComfyUI ${report.systemStats.comfyuiVersion || 'unknown'} · os ${report.systemStats.os || 'n/a'}`);
    console.log(`        ram: ${formatBytes(report.systemStats.ramFree)} free of ${formatBytes(report.systemStats.ramTotal)} · devices ${report.systemStats.devices}`);
  } else {
    console.log(`        ${report.systemStats.error}`);
  }
  console.log(`[${line(report.queue.ok)}] queue`);
  if (report.queue.ok) {
    console.log(`        running ${report.queue.runningCount} · pending ${report.queue.pendingCount}`);
  } else {
    console.log(`        ${report.queue.error}`);
  }
  console.log(`[${line(report.webSocket.ok)}] websocket`);
  if (report.webSocket.ok) {
    console.log(`        ${report.webSocketUrl}`);
    console.log(`        first message: ${report.webSocket.firstMessageType || 'n/a'} · ${report.webSocket.latencyMs} ms · queue_remaining ${report.webSocket.queueRemaining}`);
  } else {
    console.log(`        ${report.webSocket.error}`);
  }
  console.log('------------------------------------------------------------');
  console.log(report.ok ? '✅ ComfyUI is reachable and ready.' : '❌ ComfyUI check failed.');
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log('Usage: node tools/comfyui-check.js [--url=http://host:port] [--timeout=ms] [--json]');
    return 0;
  }

  const client = new ComfyUIClient({
    baseUrl: options.baseUrl,
    ...(Number.isFinite(options.timeoutMs) ? { timeoutMs: options.timeoutMs } : {})
  });
  const report = await client.checkHealth();

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);

  return report.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`ComfyUI check crashed: ${error && error.message ? error.message : error}`);
    process.exit(1);
  });
