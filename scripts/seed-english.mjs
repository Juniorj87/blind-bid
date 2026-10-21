// Полностью английский демо-набор на свежем контракте (в контракт добавлена renameTender).
//   node scripts/seed-english.mjs
//
// Делает: деплой SealStore → BlindBid, два англоязычных лота,
// три зашифрованные заявки, award, наполнение демо-аккаунтов газом.
// Обновляет deployments.json, web/src/config.ts и web/src/demo-accounts.ts.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http, encodeFunctionData, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, shieldedWriteContract, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });

const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts.json'), 'utf8'));
const RPC_CANDIDATES = [
  process.env.RPC_URL,
  'https://testnet-3.seismictest.net/rpc',
  'https://testnet-2.seismictest.net/rpc',
  'https://testnet-1.seismictest.net/rpc',
].filter(Boolean);
const SUSDC = '0x790701048922e265105fd6a4467a2901c2201c43';
const EXPLORER = 'https://seismic-testnet.socialscan.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = privateKeyToAccount(process.env.MAIN_PK);
const susdcAbi = [
  { type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
];

async function works(rpc, bytecode) {
  try {
    const r = await fetch(rpc, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_estimateGas', params: [{ from: main.address, data: bytecode }] }),
    });
    return r.status === 200;
  } catch { return false; }
}

let RPC = null;
for (const rpc of RPC_CANDIDATES) {
  if (await works(rpc, art.BlindBid.bytecode + '0'.repeat(24))) { RPC = rpc; break; }
  console.log(`  ${rpc} — не принимает крупный init code, пробуем следующий`);
}
if (!RPC) { console.error('ни один RPC не принимает крупный init code'); process.exit(1); }
console.log('RPC:', RPC);

const pub = createShieldedPublicClient({ chain: seismicTestnet, transport: http(RPC) });
const wallet = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC), account: main, publicClient: pub });

async function deploy(name, args = []) {
  const a = art[name];
  const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${name} -> ${rc.contractAddress} (gas ${rc.gasUsed})`);
  await sleep(600);
  return rc.contractAddress;
}

async function send(to, data) {
  const hash = await wallet.sendTransaction({ to, data, value: 0n });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

console.log('1) deploy');
const sealStore = await deploy('SealStore');
const blindBid = await deploy('BlindBid', [sealStore]);



console.log('2) lot #1 — open');
await send(blindBid, encodeFunctionData({
  abi: art.BlindBid.abi, functionName: 'createTender',
  args: ['Supply of server hardware', 'Bid amounts stay sealed until award', parseUnits('100', 6), BigInt(Math.floor(Date.now() / 1000) + 90), false],
}));

console.log('3) three suppliers file sealed bids (tx 0x4A)');
const suppliers = [
  { label: 'Buyer (demo)', amount: parseUnits('50', 6) },
  { label: 'Supplier (demo)', amount: parseUnits('12', 6) },
  { label: 'Supplier B (demo)', amount: parseUnits('90', 6) },
];
for (const s of suppliers) {
  const pk = generatePrivateKey();
  const acc = privateKeyToAccount(pk);
  try {
    await send(SUSDC, encodeFunctionData({ abi: susdcAbi, functionName: 'transfer', args: [acc.address, parseUnits('0.002', 6)] }));
  } catch (e) { console.log('  ! not enough gas to fund', s.label); break; }
  const w = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC), account: acc, publicClient: pub });
  const hash = await shieldedWriteContract(w, {
    address: blindBid, abi: art.BlindBid.abi, functionName: 'submitBid', args: [0n, s.amount],
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${s.label}: ${Number(s.amount) / 1e6} sUSDC, tx ${hash.slice(0, 12)}…`);
  s.pk = pk; s.address = acc.address;
}

console.log('4) waiting for the bid window to close');
const deadline = Math.floor(Date.now() / 1000) + 90;
while (Math.floor(Date.now() / 1000) < deadline + 3) await sleep(5000);
console.log('   window closed, awarding');
const award = await send(blindBid, encodeFunctionData({ abi: art.BlindBid.abi, functionName: 'closeAndAward', args: [0n] }));
console.log('  award tx', award.slice(0, 14), '…');

console.log('5) lot #2 — open, still accepting bids');
await send(blindBid, encodeFunctionData({
  abi: art.BlindBid.abi, functionName: 'createTender',
  args: ['Confidential audit of a treasury', 'The winning price is not published', parseUnits('250', 6), BigInt(Math.floor(Date.now() / 1000) + 86400), true],
}));

console.log('6) demo accounts for the front end');
const webAccounts = suppliers
  .filter((s) => s.pk)
  .map((s) => ({ label: s.label, pk: s.pk, address: s.address }));


const deployments = {
  chainId: 5124, rpc: RPC, readRpc: process.env.RPC_URL || RPC, explorer: EXPLORER, susdc: SUSDC,
  deployedAt: new Date().toISOString(),
  contracts: {
    SealStore: { address: sealStore, hash: null },
    BlindBid: { address: blindBid, hash: null },
  },
  events: [],
};
fs.writeFileSync(path.join(ROOT, 'deployments.json'), JSON.stringify(deployments, null, 2));

const cfgPath = path.join(ROOT, 'web', 'src', 'config.ts');
let cfg = fs.readFileSync(cfgPath, 'utf8');
cfg = cfg
  .replace(/BlindBid: '0x[0-9a-fA-F]+'/, `BlindBid: '${blindBid}'`)
  .replace(/SealStore: '0x[0-9a-fA-F]+'/, `SealStore: '${sealStore}'`);
fs.writeFileSync(cfgPath, cfg);

const accPath = path.join(ROOT, 'web', 'src', 'demo-accounts.ts');
const accTs = `// ДЕМО-АККАУНТЫ ТЕСТНЕТА — burner-ключи с тестовыми sUSDC, ценности не имеют.
// Сгенерированы scripts/seed-english.mjs; пополняются через scripts/fund-demo.mjs.
import { privateKeyToAccount } from 'viem/accounts';

const KEYS = ${JSON.stringify(webAccounts.map((a) => ({ label: a.label, pk: a.pk })), null, 2)};

export const DEMO_ACCOUNTS = KEYS.map((k) => ({ ...k, address: privateKeyToAccount(k.pk as \`0x\${string}\`).address }));
`;
fs.writeFileSync(accPath, accTs);

console.log('\nBlindBid =', blindBid);
console.log('updated: deployments.json, web/src/config.ts, web/src/demo-accounts.ts');
