// Деплой BlindBid на Seismic testnet: SealStore → BlindBid.
// Результат: blind-bid/deployments.json
//
// Нюанс: публичные RPC-прокси testnet-1/2 отдают 500 на estimateGas для init code >~5KB,
// поэтому перебираем эндпоинты и берём тот, который пропускает деплой (chainId у всех 5124).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') }); // .env лежит на уровень выше проекта

const SUSDC = '0x790701048922e265105fd6a4467a2901c2201c43';
const EXPLORER = 'https://seismic-testnet.socialscan.io';
const RPC_CANDIDATES = [
  process.env.RPC_URL,
  'https://testnet-3.seismictest.net/rpc',
  'https://testnet-2.seismictest.net/rpc',
  'https://testnet-1.seismictest.net/rpc',
].filter(Boolean);

const artifacts = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts.json'), 'utf8'));
const account = privateKeyToAccount(process.env.MAIN_PK);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mkClients(rpc) {
  const pub = createShieldedPublicClient({ chain: seismicTestnet, transport: http(rpc) });
  const wallet = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(rpc), account, publicClient: pub });
  return { pub, wallet };
}

async function works(rpc, bytecode) {
  try {
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_estimateGas', params: [{ from: account.address, data: bytecode }] }),
    });
    return r.status === 200;
  } catch { return false; }
}

async function deploy(wallet, pub, name, args = [], gas) {
  const a = artifacts[name];
  const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args, ...(gas ? { gas } : {}) });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`deployed ${name} -> ${rc.contractAddress}  gas=${rc.gasUsed}`);
  console.log(`   ${EXPLORER}/address/${rc.contractAddress}`);
  await sleep(800);
  return { address: rc.contractAddress, hash };
}

// выбираем RPC, который пропускает крупный init code
const bigCode = artifacts.BlindBid.bytecode + '0'.repeat(24);
let RPC = null;
for (const rpc of RPC_CANDIDATES) {
  if (await works(rpc, bigCode)) { RPC = rpc; break; }
  console.log(`  ${rpc} — не принимает крупный init code, пробуем следующий`);
}
if (!RPC) { console.error('ни один RPC не принимает BlindBid'); process.exit(1); }
console.log('используем RPC:', RPC);

const { pub, wallet } = await mkClients(RPC);

const sealStore = await deploy(wallet, pub, 'SealStore');
const blindBid = await deploy(wallet, pub, 'BlindBid', [sealStore.address]);

// deployments.json пишем ДО наполнения фаусета, чтобы не потерять адреса при нехватке газа
const deployments = {
  chainId: 5124,
  rpc: RPC,
  readRpc: process.env.RPC_URL || RPC,
  explorer: EXPLORER,
  susdc: SUSDC,
  deployedAt: new Date().toISOString(),
  contracts: { SealStore: sealStore, BlindBid: blindBid },
};
fs.writeFileSync(path.join(ROOT, 'deployments.json'), JSON.stringify(deployments, null, 2));

console.log('\n-> deployments.json');
