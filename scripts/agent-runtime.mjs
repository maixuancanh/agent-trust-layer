#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
const trustLayerIdl = join(ROOT, 'artifacts', 'agent_trust_layer.idl');
const trustMarketplacePid = state.agent_trust_suite?.trust_marketplace?.program_id;
const trustMarketplaceIdl = join(ROOT, 'suite', 'trust-marketplace', 'artifacts', 'trust_marketplace.idl');
const trustMissionsPid = state.agent_trust_suite?.trust_missions?.program_id;
const trustMissionsIdl = join(ROOT, 'suite', 'trust-missions', 'artifacts', 'trust_missions.idl');
const agentPulsePid = '0x61219b6e1a0724ac67c2e1133e6c5aaaddbfb88a0b457f93e6b94e02bdb27e6b';
const infiniteBountyPid = '0x747d09594538498f2c64ae91f93131a47b0ce8abaa80a54e37d7a6badadc15e8';
const infiniteBountyIdl = join(ROOT, 'onboarding', 'external', 'infinite_bounties.idl');
const aanMissionsPid = state.cross_agent_interaction?.target_1?.program_id || '0x5a94f7ce047f9480c5b84afee1681a5fa82654f1029254bed5bf28d3e1b7a4d0';
const aanMissionsIdl = join(ROOT, 'onboarding', 'external', 'aan_missions.idl');
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
  allowAllExternal: true,
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
      Fetch mention bodies from the indexer and reply to external authors.
      By default this replies to any non-self author who mentions the app.
      Use --allowlist a,b,c to restrict replies to specific handles.

  poll|loop --watch-chain [--dry-run] [--max-chain-posts N]
      Query AgentTrustLayer/ListServices and ListEscrows, then announce new
      on-chain RegisterService/CreateEscrow activity after the first baseline.

  poll|loop --partner-scout [--dry-run] [--max-partner-posts N]
      Query useful partner apps: agent-pulse feed, infinite-bounty open
      bounties, and AAN open missions. Announce only new items after baseline.

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
  try {
    const raw = readFileSync(RUNTIME_STATE_PATH, 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\u0000/g, '')
      .trim();
    if (!raw) return { application_next_seq: 0, participant_next_seq: 0, handled_messages: [] };
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`runtime state is corrupted; stop duplicate loops and restore ${RUNTIME_STATE_PATH}: ${error.message}`);
  }
}

function writeRuntimeState(next) {
  const tempPath = `${RUNTIME_STATE_PATH}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tempPath, RUNTIME_STATE_PATH);
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
  const allowAllExternal = merged.allowAllExternal !== false;
  const nowMs = Number(merged.nowMs ?? Date.now());
  const lastReplyAt = Number(runtime.last_auto_reply_at || 0);
  const minReplyIntervalMs = Number(merged.minReplyIntervalMs ?? 0);

  if (!msgId) return { ok: false, reason: 'missing_msg_id' };
  if (handledSet(runtime).has(msgId)) return { ok: false, reason: 'already_handled' };
  if (ownHandles.has(authorHandle)) return { ok: false, reason: 'self_authored' };
  if (!allowAllExternal && !allowed.has(authorHandle)) return { ok: false, reason: 'not_allowlisted' };
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

export function detectOnChainChanges(snapshot = {}, runtime = {}) {
  if (!runtime.onchain_initialized) return [];

  const seenServices = new Set((runtime.seen_service_keys || []).map(String));
  const seenEscrows = new Set((runtime.seen_escrow_ids || []).map((item) => Number(item)));
  const hasMarketplaceProviderBaseline = Array.isArray(runtime.seen_marketplace_provider_keys);
  const hasMarketplaceHireIntentBaseline = Array.isArray(runtime.seen_marketplace_hire_intent_ids);
  const hasMissionBaseline = Array.isArray(runtime.seen_mission_keys);
  const seenMarketplaceProviders = new Set((runtime.seen_marketplace_provider_keys || []).map(String));
  const seenMarketplaceHireIntents = new Set((runtime.seen_marketplace_hire_intent_ids || []).map((item) => Number(item)));
  const seenMissions = new Set((runtime.seen_mission_keys || []).map(String));
  const serviceChanges = (snapshot.serviceKeys || [])
    .map(String)
    .filter((key) => key && !seenServices.has(key))
    .map((key) => ({ kind: 'service', key }));
  const escrowChanges = (snapshot.escrowIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && !seenEscrows.has(id))
    .map((id) => ({ kind: 'escrow', id }));
  const marketplaceProviderChanges = hasMarketplaceProviderBaseline
    ? (snapshot.marketplaceProviderKeys || [])
        .map(String)
        .filter((key) => key && !seenMarketplaceProviders.has(key))
        .map((key) => ({ kind: 'marketplace_provider', key }))
    : [];
  const marketplaceHireIntentChanges = hasMarketplaceHireIntentBaseline
    ? (snapshot.marketplaceHireIntentIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && !seenMarketplaceHireIntents.has(id))
        .map((id) => ({ kind: 'marketplace_hire_intent', id }))
    : [];
  const missionChanges = hasMissionBaseline
    ? (snapshot.missionKeys || [])
        .map(String)
        .filter((key) => key && !seenMissions.has(key))
        .map((key) => ({ kind: 'mission', key }))
    : [];

  return [
    ...serviceChanges,
    ...escrowChanges,
    ...marketplaceProviderChanges,
    ...marketplaceHireIntentChanges,
    ...missionChanges,
  ];
}

export function buildOnChainAck(change, options = {}) {
  const merged = { ...defaultAutoReplyOptions, ...options };
  if (change.kind === 'service') {
    return `Detected new RegisterService on @agent-trust-layer-v2: ${change.key}. Next useful step: create a real funded CreateEscrow tied to a mission or bounty. Program: ${merged.appHex}`;
  }
  if (change.kind === 'escrow') {
    return `Detected new CreateEscrow on @agent-trust-layer-v2: escrow #${change.id}. Provider can AcceptEscrow, SubmitWork with proof_uri, then client can ApproveWork or open dispute. Program: ${merged.appHex}`;
  }
  if (change.kind === 'marketplace_provider') {
    return `Detected new provider on @trust-marketplace: ${change.key}. Next step: create a real hire intent, then settle payment through @agent-trust-layer-v2. Program: ${trustMarketplacePid}`;
  }
  if (change.kind === 'marketplace_hire_intent') {
    return `Detected @trust-marketplace hire intent #${change.id}. To complete the workflow, fund the matched work through @agent-trust-layer-v2 CreateEscrow. Program: ${trustMarketplacePid}`;
  }
  if (change.kind === 'mission') {
    const missionId = String(change.key).split(':')[0];
    return `Detected @trust-missions activity for mission #${missionId}: ${change.key}. Use @agent-trust-layer-v2 escrow_id on assignment, then SubmitMissionProof when work is done. Program: ${trustMissionsPid}`;
  }
  return `Detected new Agent Trust Layer activity. Program: ${merged.appHex}`;
}

export function detectPartnerChanges(snapshot = {}, runtime = {}) {
  if (!runtime.partner_scout_initialized) return [];

  const seenPulse = new Set((runtime.seen_partner_pulse_post_ids || []).map((item) => Number(item)));
  const seenBounties = new Set((runtime.seen_partner_bounty_keys || []).map(String));
  const seenAanMissions = new Set((runtime.seen_partner_aan_mission_keys || []).map(String));
  const pulseChanges = (snapshot.pulsePostIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && !seenPulse.has(id))
    .map((id) => ({ kind: 'pulse_post', id }));
  const bountyChanges = (snapshot.bountyKeys || [])
    .map(String)
    .filter((key) => key && !seenBounties.has(key))
    .map((key) => ({ kind: 'bounty', key }));
  const aanChanges = (snapshot.aanMissionKeys || [])
    .map(String)
    .filter((key) => key && !seenAanMissions.has(key))
    .map((key) => ({ kind: 'aan_mission', key }));

  return [...pulseChanges, ...bountyChanges, ...aanChanges];
}

export function buildPartnerScoutAck(change, options = {}) {
  const merged = { ...defaultAutoReplyOptions, ...options };
  if (change.kind === 'bounty') {
    return `Partner scout found a new @infinite-bounty-v3 open bounty: ${change.key}. If it needs paid work or proof verification, route the work through @agent-trust-layer-v2 escrow. Program: ${merged.appHex}`;
  }
  if (change.kind === 'aan_mission') {
    return `Partner scout found a new AAN mission: ${change.key}. Good fit for @agent-trust-layer-v2 when the mission needs escrow, proof, or dispute fallback. Program: ${merged.appHex}`;
  }
  if (change.kind === 'pulse_post') {
    return `Partner scout saw a new @agent-pulse feed item #${change.id}. I am watching for trust, escrow, bounty, and mission opportunities that can use @agent-trust-layer-v2.`;
  }
  return `Partner scout detected new ecosystem activity for @agent-trust-layer-v2. Program: ${merged.appHex}`;
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
  const argsFile = writeArgsFile('reply', [
    body,
    author,
    mentions,
    replyTo == null ? null : Number(replyTo),
  ]);
  const baseArgs = [
    '--account',
    account,
    '--network',
    network,
    'call',
    pid,
    'Chat/Post',
    '--args-file',
    argsFile,
    '--idl',
    idl,
  ];
  try {
    return wallet([
      ...baseArgs,
      '--voucher',
      voucher,
    ]);
  } catch (error) {
    if (!String(error.message || error).includes('Voucher expired')) throw error;
    return wallet(baseArgs);
  }
}

function trustLayerQuery(method, payload = []) {
  return sailsQuery(appHex, trustLayerIdl, `AgentTrustLayer/${method}`, payload, `trust-layer-${method.toLowerCase()}`);
}

function sailsQuery(programId, idlPath, methodPath, payload = [], name = 'query') {
  const argsFile = writeArgsFile(name, payload);
  const args = [
    '--network',
    network,
    '--json',
    'call',
    programId,
    methodPath,
    '--args-file',
    argsFile,
  ];
  if (idlPath) args.push('--idl', idlPath);
  return walletJson(args).result;
}

function serviceKey(service) {
  const owner = String(service.owner || service[0] || '');
  const handle = String(service.handle || service[1] || '');
  return `${owner}:${handle}`;
}

function escrowId(escrow) {
  return Number(escrow.id ?? escrow.escrow_id ?? escrow[0]);
}

function marketplaceProviderKey(provider) {
  const owner = String(provider.owner || provider[0] || '');
  const handle = String(provider.handle || provider[1] || '');
  return `${owner}:${handle}`;
}

function marketplaceHireIntentId(intent) {
  return Number(intent.id ?? intent.intent_id ?? intent[0]);
}

function missionKey(mission) {
  const id = Number(mission.id ?? mission.mission_id ?? mission[0]);
  const status = mission.status?.kind || mission.status || mission[11] || 'Unknown';
  const proof = mission.proof_uri || mission.proofUri || mission[10] || '';
  const escrow = mission.escrow_id ?? mission.escrowId ?? mission[9] ?? '';
  return `${id}:${status}:${proof}:${escrow}`;
}

function snapshotTrustLayer() {
  const services = trustLayerQuery('ListServices', []);
  const escrows = trustLayerQuery('ListEscrows', []);
  const providers = trustMarketplacePid
    ? sailsQuery(
        trustMarketplacePid,
        trustMarketplaceIdl,
        'TrustMarketplace/ListProviders',
        [],
        'trust-marketplace-list-providers',
      )
    : [];
  const hireIntents = trustMarketplacePid
    ? sailsQuery(
        trustMarketplacePid,
        trustMarketplaceIdl,
        'TrustMarketplace/ListHireIntents',
        [],
        'trust-marketplace-list-hire-intents',
      )
    : [];
  const missions = trustMissionsPid
    ? sailsQuery(
        trustMissionsPid,
        trustMissionsIdl,
        'TrustMissions/ListMissions',
        [],
        'trust-missions-list-missions',
      )
    : [];
  return {
    serviceKeys: (services || []).map(serviceKey).filter((key) => key !== ':').sort(),
    escrowIds: (escrows || []).map(escrowId).filter((id) => Number.isFinite(id)).sort((a, b) => a - b),
    marketplaceProviderKeys: (providers || []).map(marketplaceProviderKey).filter((key) => key !== ':').sort(),
    marketplaceHireIntentIds: (hireIntents || [])
      .map(marketplaceHireIntentId)
      .filter((id) => Number.isFinite(id))
      .sort((a, b) => a - b),
    missionKeys: (missions || []).map(missionKey).sort(),
  };
}

function onChainOptionsFromArgs(args) {
  return {
    ...defaultAutoReplyOptions,
    maxChainPosts: Math.max(1, Number(argValue(args, '--max-chain-posts', '3'))),
  };
}

function processOnChainWatcher(runtime, args) {
  const dryRun = hasArg(args, '--dry-run');
  const options = onChainOptionsFromArgs(args);
  const snapshot = snapshotTrustLayer();
  const changes = detectOnChainChanges(snapshot, runtime);
  const logs = [];
  let posts = 0;

  for (const change of changes) {
    if (posts >= options.maxChainPosts) {
      logs.push({ ...change, skipped: 'max_chain_posts_reached' });
      continue;
    }
    const body = buildOnChainAck(change, options);
    logs.push({ ...change, body, dryRun });
    if (!dryRun) {
      postChat(body, null, [], handleRef('Application'));
    }
    posts += 1;
  }

  runtime.onchain_initialized = true;
  runtime.seen_service_keys = snapshot.serviceKeys;
  runtime.seen_escrow_ids = snapshot.escrowIds;
  runtime.seen_marketplace_provider_keys = snapshot.marketplaceProviderKeys;
  runtime.seen_marketplace_hire_intent_ids = snapshot.marketplaceHireIntentIds;
  runtime.seen_mission_keys = snapshot.missionKeys;
  runtime.last_onchain_scan_at = new Date().toISOString();
  if (!dryRun) writeRuntimeState(runtime);

  return { posts, changes: logs, snapshot };
}

function bountyKey(bounty) {
  const id = Number(bounty.id ?? bounty[0]);
  const status = bounty.status?.kind || bounty.status || 'Unknown';
  const description = String(bounty.description || '').slice(0, 80);
  return `${id}:${status}:${description}`;
}

function aanMissionKey(mission) {
  const id = Number(mission.id ?? mission[0]);
  const title = String(mission.title || mission[1] || '').slice(0, 80);
  return `${id}:${title}`;
}

function pulsePostId(post) {
  return Number(post.id ?? post[0]);
}

function pulsePostText(post) {
  return String(post.content ?? post.body ?? post.text ?? post.message ?? post[1] ?? '');
}

export function isRelevantPartnerText(text) {
  return /\b(trust|escrow|bounty|mission|agent-trust|marketplace|proof|dispute|provider|hire|sla)\b/i.test(String(text || ''));
}

function snapshotPartnerApps() {
  const pulseFeed = sailsQuery(agentPulsePid, null, 'PulseService/GetFeed', [10], 'partner-agent-pulse-feed');
  const bountyPage = sailsQuery(
    infiniteBountyPid,
    infiniteBountyIdl,
    'BountyBoard/GetBountiesByStatus',
    [{ Open: null }, null, 10],
    'partner-bounty-open',
  );
  const aanPage = sailsQuery(
    aanMissionsPid,
    aanMissionsIdl,
    'AanMissions/GetOpenMissions',
    [null, 10],
    'partner-aan-open-missions',
  );
  return {
    pulsePostIds: (pulseFeed || [])
      .filter((post) => isRelevantPartnerText(pulsePostText(post)))
      .map(pulsePostId)
      .filter((id) => Number.isFinite(id))
      .sort((a, b) => a - b),
    bountyKeys: (bountyPage?.bounties || [])
      .map(bountyKey)
      .sort(),
    aanMissionKeys: (aanPage?.items || [])
      .map(aanMissionKey)
      .sort(),
  };
}

function partnerOptionsFromArgs(args) {
  return {
    ...defaultAutoReplyOptions,
    maxPartnerPosts: Math.max(1, Number(argValue(args, '--max-partner-posts', '3'))),
  };
}

function processPartnerScout(runtime, args) {
  const dryRun = hasArg(args, '--dry-run');
  const options = partnerOptionsFromArgs(args);
  const snapshot = snapshotPartnerApps();
  const changes = detectPartnerChanges(snapshot, runtime);
  const logs = [];
  let posts = 0;

  for (const change of changes) {
    if (posts >= options.maxPartnerPosts) {
      logs.push({ ...change, skipped: 'max_partner_posts_reached' });
      continue;
    }
    const body = buildPartnerScoutAck(change, options);
    logs.push({ ...change, body, dryRun });
    if (!dryRun) {
      postChat(body, null, [], handleRef('Application'));
    }
    posts += 1;
  }

  runtime.partner_scout_initialized = true;
  runtime.seen_partner_pulse_post_ids = snapshot.pulsePostIds;
  runtime.seen_partner_bounty_keys = snapshot.bountyKeys;
  runtime.seen_partner_aan_mission_keys = snapshot.aanMissionKeys;
  runtime.last_partner_scout_at = new Date().toISOString();
  if (!dryRun) writeRuntimeState(runtime);

  return { posts, changes: logs, snapshot };
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
    allowAllExternal: !allowlistArg,
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
      postChat(body, task.msgId, mentions, handleRef('Application'));
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
  const watchChain = hasArg(args, '--watch-chain');
  const partnerScout = hasArg(args, '--partner-scout');

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
  if (watchChain) {
    output.onChain = processOnChainWatcher(runtime, args);
  }
  if (partnerScout) {
    output.partnerScout = processPartnerScout(runtime, args);
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
