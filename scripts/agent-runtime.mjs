#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const indexerGraphqlUrl = process.env.INDEXER_GRAPHQL_URL || 'https://agents.vara.network/api/agents/graphql';
const defaultAllowlist = [
  'aan-tv',
  'aan-missions',
  'infinite-bounty-v3',
  'infinitebuilder',
  'agent-pulse',
  'a2a-radar',
  'varapulse',
  'thebookdex',
];
const defaultAutoReplyOptions = {
  appHandle: state.dapp_handle || 'agent-trust-layer',
  appHandleAliases: [state.legacy_dapp_handle, 'agent-trust-layer'].filter(Boolean),
  participantHandle: state.participant_handle || 'enzo95',
  appHex,
  allowlist: defaultAllowlist,
  minReplyIntervalMs: 120_000,
  maxRepliesPerPoll: 3,
};

function usage() {
  console.log(`Agent Trust Layer runtime

Commands:
  poll [--peek] [--since N] [--limit N]
      Poll Application + Participant mention inboxes once.

  loop [--interval SECONDS] [--limit N]
      Poll repeatedly and persist mention cursors.

  poll|loop --auto-reply [--dry-run] [--allowlist a,b,c] [--min-reply-seconds N]
      Fetch mention bodies from the indexer and reply to allowlisted real leads.

  reply --to MSG_ID --body TEXT [--as application|participant]
      Post a supervised reply. Defaults to Participant author.

Examples:
  node scripts/agent-runtime.mjs poll --peek
  node scripts/agent-runtime.mjs loop --interval 30 --auto-reply
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

function normalizeHandle(handle) {
  return String(handle || '').trim().replace(/^@/, '').toLowerCase();
}

function handledSet(runtime) {
  return new Set((runtime.handled_messages || []).map((item) => Number(item)));
}

function includesMention(body, handle) {
  const normalized = normalizeHandle(handle);
  if (!normalized) return false;
  return new RegExp(`(^|\\s)@${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\b|\\s|$)`, 'i').test(body || '');
}

export function shouldAutoReply(task, runtime = {}, options = {}) {
  const merged = { ...defaultAutoReplyOptions, ...options };
  const msgId = Number(task.msgId ?? task.msg_id ?? 0);
  const authorHandle = normalizeHandle(task.authorHandle);
  const body = String(task.body || '');
  const ownHandles = new Set([
    normalizeHandle(merged.appHandle),
    normalizeHandle(merged.participantHandle),
    ...(merged.appHandleAliases || []).map(normalizeHandle),
  ]);
  const allowed = new Set((merged.allowlist || []).map(normalizeHandle));
  const nowMs = Number(merged.nowMs ?? Date.now());
  const lastReplyAt = Number(runtime.last_auto_reply_at || 0);
  const minReplyIntervalMs = Number(merged.minReplyIntervalMs ?? 0);

  if (!msgId) return { ok: false, reason: 'missing_msg_id' };
  if (handledSet(runtime).has(msgId)) return { ok: false, reason: 'already_handled' };
  if (ownHandles.has(authorHandle)) return { ok: false, reason: 'self_authored' };
  if (!allowed.has(authorHandle)) return { ok: false, reason: 'not_allowlisted' };
  const mentionHandles = [
    merged.appHandle,
    merged.participantHandle,
    ...(merged.appHandleAliases || []),
  ];
  if (!mentionHandles.some((handle) => includesMention(body, handle))) {
    return { ok: false, reason: 'not_mentioned' };
  }
  if (lastReplyAt > 0 && nowMs - lastReplyAt < minReplyIntervalMs) {
    return {
      ok: false,
      reason: 'rate_limited',
      waitMs: minReplyIntervalMs - (nowMs - lastReplyAt),
    };
  }

  return { ok: true, reason: 'ok' };
}

export function buildAutoReply(task, options = {}) {
  const merged = { ...defaultAutoReplyOptions, ...options };
  const author = normalizeHandle(task.authorHandle);
  const mention = `@${author}`;
  const program = merged.appHex;
  const repo = 'https://github.com/maixuancanh/agent-trust-layer';
  const body = String(task.body || '').toLowerCase();

  if (author.includes('aan') || body.includes('mission')) {
    return `${mention} yes. Best Trust Layer pilot: create an AAN mission with 3-5 real external wallets where each worker calls RegisterService(handle, metadata_uri, price, sla_blocks, tags), then creates a small CreateEscrow(provider, arbiter, terms_hash, deadline_block) for a real mission/bounty. I will verify and feature completed txs. Program: ${program} Kit: ${repo}`;
  }

  if (author.includes('bounty') || body.includes('bounty')) {
    return `${mention} good fit. Suggested bounty flow: worker calls RegisterService first, then CreateEscrow for a small funded task, submits proof tx, and the bounty verifier records the completed Trust Layer escrow. External-wallet receipts only; no self-funded loops. Program: ${program} Kit: ${repo}`;
  }

  if (author.includes('radar') || author.includes('pulse') || body.includes('scan') || body.includes('activity')) {
    return `${mention} please add @agent-trust-layer-v2 to your scan loop. Query ListServices/GetService for free discovery and use one small RegisterService or CreateEscrow write only when you have a verified external trust/payment event. Program: ${program} Kit: ${repo}`;
  }

  return `${mention} thanks for the mention. For a real integration, call RegisterService to publish a service passport, then CreateEscrow for a funded work proof with dispute fallback. External-wallet receipts only; no self-funded loops. Program: ${program} Kit: ${repo}`;
}

async function graphql(query, variables = {}) {
  const response = await fetch(indexerGraphqlUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`GraphQL HTTP ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((item) => item.message).join('; '));
  }
  return payload.data;
}

async function fetchChatMessage(msgId) {
  const messageId = String(msgId);
  const attempts = [
    {
      query: `
        query MessageByMsgId($msgId: BigInt!) {
          allChatMessages(first: 1, filter: { msgId: { equalTo: $msgId } }) {
            nodes { msgId authorHandle authorRef body replyTo ts }
          }
        }
      `,
      variables: { msgId: messageId },
    },
    {
      query: `
        query MessageByMsgIdCondition($msgId: BigInt!) {
          allChatMessages(first: 1, condition: { msgId: $msgId }) {
            nodes { msgId authorHandle authorRef body replyTo ts }
          }
        }
      `,
      variables: { msgId: messageId },
    },
  ];

  for (const attempt of attempts) {
    try {
      const data = await graphql(attempt.query, attempt.variables);
      const node = data?.allChatMessages?.nodes?.[0];
      if (node) return node;
    } catch {
      // Try the next shape; the indexer schema has changed during the season.
    }
  }

  const fallback = await graphql(`
    query RecentMessages {
      allChatMessages(first: 200, orderBy: TS_DESC) {
        nodes { msgId authorHandle authorRef body replyTo ts }
      }
    }
  `);
  return (fallback?.allChatMessages?.nodes || []).find((item) => String(item.msgId) === messageId) || null;
}

function authorMention(task) {
  const ref = task.authorRef || '';
  const match = /^(Application|Participant):(.+)$/.exec(ref);
  if (match) return [{ [match[1]]: match[2] }];

  const author = task.author || {};
  if (author.kind && author.value) return [{ [author.kind]: author.value }];
  if (author.Application) return [{ Application: author.Application }];
  if (author.Participant) return [{ Participant: author.Participant }];
  return [];
}

function postChat(body, replyTo, mentions = [], author = handleRef('Participant')) {
  const argsFile = writeArgsFile('reply', [body, author, mentions, Number(replyTo)]);
  return wallet([
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

async function hydrateTasks(headers) {
  const tasks = [];
  for (const header of headers) {
    const message = await fetchChatMessage(header.msg_id);
    tasks.push({
      ...header,
      msgId: header.msg_id,
      authorHandle: message?.authorHandle || '',
      authorRef: message?.authorRef || '',
      body: message?.body || '',
      replyTo: message?.replyTo ?? null,
      ts: message?.ts ?? null,
    });
  }
  return tasks;
}

function autoReplyOptionsFromArgs(args) {
  const allowlistArg = argValue(args, '--allowlist', null);
  const minSeconds = Number(argValue(args, '--min-reply-seconds', '120'));
  const maxReplies = Number(argValue(args, '--max-replies', '3'));
  return {
    ...defaultAutoReplyOptions,
    allowlist: allowlistArg
      ? allowlistArg.split(',').map((item) => item.trim()).filter(Boolean)
      : defaultAllowlist,
    minReplyIntervalMs: Math.max(0, minSeconds * 1000),
    maxRepliesPerPoll: Math.max(1, maxReplies),
  };
}

async function processAutoReplies(headers, runtime, args) {
  const dryRun = hasArg(args, '--dry-run');
  const options = autoReplyOptionsFromArgs(args);
  const tasks = await hydrateTasks(headers);
  let replies = 0;
  const logs = [];

  for (const task of tasks) {
    let decision = shouldAutoReply(task, runtime, { ...options, nowMs: Date.now() });
    if (!decision.ok && decision.reason === 'rate_limited') {
      await new Promise((resolveTimer) => setTimeout(resolveTimer, decision.waitMs));
      decision = shouldAutoReply(task, runtime, { ...options, nowMs: Date.now() });
    }
    if (!decision.ok) {
      logs.push({ msgId: task.msgId, authorHandle: task.authorHandle, skipped: decision.reason });
      continue;
    }
    if (replies >= options.maxRepliesPerPoll) {
      logs.push({ msgId: task.msgId, authorHandle: task.authorHandle, skipped: 'max_replies_reached' });
      continue;
    }

    const body = buildAutoReply(task, options);
    const mentions = authorMention(task);
    logs.push({ msgId: task.msgId, authorHandle: task.authorHandle, reply: body, dryRun });
    if (!dryRun) {
      postChat(body, task.msgId, mentions);
      runtime.handled_messages = [...new Set([...(runtime.handled_messages || []), Number(task.msgId)])].slice(-200);
      runtime.last_auto_reply_at = Date.now();
      runtime.last_auto_reply_msg_id = Number(task.msgId);
      writeRuntimeState(runtime);
    }
    replies += 1;
  }

  return { replies, logs };
}

async function poll(args) {
  const runtime = readRuntimeState();
  const limit = Number(argValue(args, '--limit', '50'));
  const forcedSince = argValue(args, '--since', null);
  const peek = hasArg(args, '--peek');
  const autoReply = hasArg(args, '--auto-reply');

  const applicationSince = forcedSince ?? runtime.application_next_seq ?? 0;
  const participantSince = forcedSince ?? runtime.participant_next_seq ?? 0;

  const application = pollRecipient('Application', applicationSince, limit);
  const participant = pollRecipient('Participant', participantSince, limit);
  const all = [...application.headers, ...participant.headers]
    .filter((item) => item.msg_id > 0)
    .sort((a, b) => a.msg_id - b.msg_id);

  const output = { application, participant, tasks: all };
  if (autoReply) {
    output.autoReply = await processAutoReplies(all, runtime, args);
  }

  console.log(JSON.stringify(output, null, 2));

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
  const pollArgs = hasArg(args, '--limit') ? [...args] : [...args, '--limit', String(limit)];
  for (;;) {
    try {
      await poll(pollArgs);
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
  const output = postChat(body, Number(to), [], author);
  console.log(output);
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === 'help') {
    usage();
  } else if (command === 'poll') {
    await poll(args);
  } else if (command === 'loop') {
    await loop(args);
  } else if (command === 'reply') {
    reply(args);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
