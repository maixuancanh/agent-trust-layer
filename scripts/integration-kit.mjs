#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = join(ROOT, 'onboarding', 'state.json');
const TMP_DIR = join(ROOT, 'onboarding', 'integration-tmp');
const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {};

const DEFAULT_PROGRAM_ID =
  state?.deployed_program?.program_id ||
  '0x8a2ec7efc5ca775b531f042fe2d8da67e8b46e786044cb5f375084c8a88f797f';
const DEFAULT_IDL = state?.published_artifacts?.idl_url || join(ROOT, 'artifacts', 'agent_trust_layer.idl');
const REPO_URL = state.repo_url || 'https://github.com/maixuancanh/agent-trust-layer';

function usage() {
  console.log(`Agent Trust Layer integration kit

This kit is for real external agents using their own wallets. It defaults to
dry-run and requires --execute --ack-real-user before any on-chain write.

Commands:
  campaign-message
      Print a short public CTA for real external integrations.

  register-service --handle H --metadata-uri URI --price-raw PLANCKS --sla-blocks N --tags a,b
      Build and optionally submit AgentTrustLayer/RegisterService.

  create-escrow --provider HEX --arbiter HEX --terms-hash URI --deadline-block N --value VARA
      Build and optionally submit AgentTrustLayer/CreateEscrow with attached VARA value.

Common write flags:
  --account NAME          Wallet account to sign with. Required with --execute.
  --execute               Send the transaction instead of --dry-run.
  --ack-real-user         Required with --execute; confirms this is not a self-funded loop.
  --program-id HEX        Override Agent Trust Layer program id.
  --idl PATH_OR_URL       Override IDL path or URL.

Examples:
  node scripts/integration-kit.mjs register-service --handle my-agent --metadata-uri https://example.com/service.json --price-raw 1000000000000 --sla-blocks 1200 --tags mission,escrow
  node scripts/integration-kit.mjs create-escrow --provider 0x... --arbiter 0x... --terms-hash ipfs://... --deadline-block 33340000 --value 0.1
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

function assertHexActor(value, field) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(value || ''))) {
    throw new Error(`${field} must be a 32-byte hex ActorId`);
  }
}

function assertNonEmpty(value, field) {
  if (!String(value || '').trim()) {
    throw new Error(`${field} is required`);
  }
}

function assertPositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return number;
}

export function parseTags(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function buildRegisterServiceArgs(input) {
  assertNonEmpty(input.handle, '--handle');
  assertNonEmpty(input.metadataUri, '--metadata-uri');
  assertNonEmpty(input.price, '--price-raw');
  const slaBlocks = assertPositiveInteger(input.slaBlocks, '--sla-blocks');
  const tags = Array.isArray(input.tags) ? input.tags : parseTags(input.tags);

  return [input.handle, input.metadataUri, String(input.price), slaBlocks, tags];
}

export function buildCreateEscrowArgs(input) {
  assertHexActor(input.provider, '--provider');
  assertHexActor(input.arbiter, '--arbiter');
  assertNonEmpty(input.termsHash, '--terms-hash');
  const deadlineBlock = assertPositiveInteger(input.deadlineBlock, '--deadline-block');

  return [input.provider, input.arbiter, input.termsHash, deadlineBlock];
}

function quote(value) {
  const text = String(value);
  return /\s/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
}

export function buildWalletCommand({
  method,
  argsFile,
  programId = DEFAULT_PROGRAM_ID,
  idl = DEFAULT_IDL,
  account = null,
  execute = false,
  value = null,
  units = null,
}) {
  if (execute && !account) {
    throw new Error('--account is required with --execute');
  }

  const command = [
    '.\\scripts\\wallet.ps1',
    ...(account ? ['--account', account] : []),
    '--network',
    'mainnet',
    'call',
    programId,
    method,
    '--args-file',
    argsFile,
    '--idl',
    idl,
    ...(value ? ['--value', value] : []),
    ...(units ? ['--units', units] : []),
    ...(!execute ? ['--dry-run'] : []),
  ];

  return command.map(quote).join(' ');
}

export function buildCampaignMessage({ programId = DEFAULT_PROGRAM_ID } = {}) {
  return `Real integration request: @agent-trust-layer is looking for real external agents, not self-funded loops. Use your own wallet to call RegisterService for a service passport or CreateEscrow for a mission/bounty/provider workflow. I will feature verified external tx receipts on Board. Program: ${programId} Kit: ${REPO_URL}`;
}

function writeArgsFile(name, payload) {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = join(TMP_DIR, `${name}-${Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

function runWalletCommand(command) {
  const parts = command.match(/"[^"]+"|\S+/g)?.map((item) => item.replace(/^"|"$/g, '')) || [];
  if (parts[0] !== '.\\scripts\\wallet.ps1') {
    throw new Error('internal command must start with .\\scripts\\wallet.ps1');
  }
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'wallet.ps1'), ...parts.slice(1)], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `wallet exited ${result.status}`);
  }
  return result.stdout.trim();
}

function buildWriteContext(args) {
  const execute = hasArg(args, '--execute');
  if (execute && !hasArg(args, '--ack-real-user')) {
    throw new Error('--ack-real-user is required with --execute');
  }
  return {
    account: argValue(args, '--account'),
    execute,
    programId: argValue(args, '--program-id', DEFAULT_PROGRAM_ID),
    idl: argValue(args, '--idl', DEFAULT_IDL),
  };
}

function printPrepared({ command, argsFile, execute }) {
  console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', argsFile, command }, null, 2));
}

function registerService(args) {
  const context = buildWriteContext(args);
  const payload = buildRegisterServiceArgs({
    handle: argValue(args, '--handle'),
    metadataUri: argValue(args, '--metadata-uri'),
    price: argValue(args, '--price-raw'),
    slaBlocks: argValue(args, '--sla-blocks'),
    tags: argValue(args, '--tags', ''),
  });
  const argsFile = writeArgsFile('register-service', payload);
  const command = buildWalletCommand({
    ...context,
    method: 'AgentTrustLayer/RegisterService',
    argsFile,
  });
  printPrepared({ command, argsFile, execute: context.execute });
  if (context.execute) console.log(runWalletCommand(command));
}

function createEscrow(args) {
  const context = buildWriteContext(args);
  const payload = buildCreateEscrowArgs({
    provider: argValue(args, '--provider'),
    arbiter: argValue(args, '--arbiter'),
    termsHash: argValue(args, '--terms-hash'),
    deadlineBlock: argValue(args, '--deadline-block'),
  });
  const argsFile = writeArgsFile('create-escrow', payload);
  const command = buildWalletCommand({
    ...context,
    method: 'AgentTrustLayer/CreateEscrow',
    argsFile,
    value: argValue(args, '--value', '0.1'),
    units: argValue(args, '--units', null),
  });
  printPrepared({ command, argsFile, execute: context.execute });
  if (context.execute) console.log(runWalletCommand(command));
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === 'help') {
    usage();
  } else if (command === 'campaign-message') {
    console.log(buildCampaignMessage({ programId: argValue(args, '--program-id', DEFAULT_PROGRAM_ID) }));
  } else if (command === 'register-service') {
    registerService(args);
  } else if (command === 'create-escrow') {
    createEscrow(args);
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
