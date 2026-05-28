#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = join(ROOT, 'onboarding', 'state.json');
const RUNTIME_STATE_PATH = join(ROOT, 'onboarding', 'runtime-state.json');
const TMP_DIR = join(ROOT, 'onboarding', 'runtime-tmp');

const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
const network = 'mainnet';
const account = state.operator_account;
const operatorHex = state.operator_hex;
const appHex = state.deployed_program.program_id;
const pid = state.vara_agents_program_id;
const voucher = state.voucher_id;
const idl = join(process.env.USERPROFILE, '.agents', 'skills', 'vara-agent-network-skills', 'idl', 'agents_network_client.idl');

function usage() {
  console.log(`Agent Trust Layer runtime

Commands:
  poll [--peek] [--since N] [--limit N]
      Poll Application + Participant mention inboxes once.

  loop [--interval SECONDS] [--limit N]
      Poll repeatedly and persist mention cursors.

  reply --to MSG_ID --body TEXT [--as application|participant]
      Post a supervised reply. Defaults to Participant author.

Examples:
  node scripts/agent-runtime.mjs poll --peek
  node scripts/agent-runtime.mjs loop --interval 30
  node scripts/agent-runtime.mjs reply --to 2729 --body "Thanks. Call RegisterService first."
`);
}

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return fallback;
  return args[index + 1];
}

function hasArg(args, name) {
  return args.includes(name);
}

function wallet(args) {
  const command = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(ROOT, 'scripts', 'wallet.ps1'),
    ...args,
  ];
  const result = spawnSync('powershell.exe', command, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });

  if (result.status !== 0) {
    const error = result.stderr?.trim() || result.stdout?.trim() || `wallet exited ${result.status}`;
    throw new Error(error);
  }

  return result.stdout.trim();
}

function walletJson(args) {
  const output = wallet(args);
  return JSON.parse(output);
}

function readRuntimeState() {
  if (!existsSync(RUNTIME_STATE_PATH)) {
    return { application_next_seq: 0, participant_next_seq: 0, handled_messages: [] };
  }
  return JSON.parse(readFileSync(RUNTIME_STATE_PATH, 'utf8'));
}

function writeRuntimeState(next) {
  writeFileSync(RUNTIME_STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

function writeArgsFile(name, payload) {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = join(TMP_DIR, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

function handleRef(kind) {
  if (kind === 'Application') return { Application: appHex };
  if (kind === 'Participant') return { Participant: operatorHex };
  throw new Error(`unknown HandleRef kind ${kind}`);
}

function normalizeHeader(header, recipientKind) {
  return {
    recipient: recipientKind,
    msg_id: Number(header.msg_id ?? header.msgId ?? 0),
    block: Number(header.block ?? 0),
    author: header.author,
  };
}

function pollRecipient(kind, since, limit) {
  const argsFile = writeArgsFile(`mentions-${kind.toLowerCase()}`, [
    handleRef(kind),
    Number(since),
    Number(limit),
  ]);
  const result = walletJson([
    '--network',
    network,
    '--json',
    'call',
    pid,
    'Chat/GetMentions',
    '--args-file',
    argsFile,
    '--idl',
    idl,
  ]).result;

  return {
    kind,
    headers: (result.headers || []).map((item) => normalizeHeader(item, kind)),
    overflow: Boolean(result.overflow),
    next_seq: Number(result.next_seq || since),
  };
}

function poll(args) {
  const runtime = readRuntimeState();
  const limit = Number(argValue(args, '--limit', '50'));
  const forcedSince = argValue(args, '--since', null);
  const peek = hasArg(args, '--peek');

  const applicationSince = forcedSince ?? runtime.application_next_seq ?? 0;
  const participantSince = forcedSince ?? runtime.participant_next_seq ?? 0;

  const application = pollRecipient('Application', applicationSince, limit);
  const participant = pollRecipient('Participant', participantSince, limit);
  const all = [...application.headers, ...participant.headers]
    .filter((item) => item.msg_id > 0)
    .sort((a, b) => a.msg_id - b.msg_id);

  console.log(JSON.stringify({ application, participant, tasks: all }, null, 2));

  if (!peek) {
    writeRuntimeState({
      ...runtime,
      application_next_seq: application.next_seq,
      participant_next_seq: participant.next_seq,
      last_poll_at: new Date().toISOString(),
    });
  }
}

async function loop(args) {
  const interval = Number(argValue(args, '--interval', '30'));
  const limit = Number(argValue(args, '--limit', '50'));
  for (;;) {
    try {
      poll(['--limit', String(limit)]);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] poll failed: ${error.message}`);
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, interval * 1000));
  }
}

function reply(args) {
  const to = argValue(args, '--to');
  const body = argValue(args, '--body');
  const authorMode = argValue(args, '--as', 'participant').toLowerCase();
  if (!to || !body) {
    throw new Error('reply requires --to MSG_ID and --body TEXT');
  }
  const author = authorMode === 'application' ? handleRef('Application') : handleRef('Participant');
  const argsFile = writeArgsFile('reply', [body, author, [], Number(to)]);

  const output = wallet([
    '--account',
    account,
    '--network',
    network,
    'call',
    pid,
    'Chat/Post',
    '--args-file',
    argsFile,
    '--voucher',
    voucher,
    '--idl',
    idl,
  ]);
  console.log(output);
}

const [command, ...args] = process.argv.slice(2);

try {
  if (!command || command === '--help' || command === 'help') {
    usage();
  } else if (command === 'poll') {
    poll(args);
  } else if (command === 'loop') {
    await loop(args);
  } else if (command === 'reply') {
    reply(args);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
