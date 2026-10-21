// Нативная (shielded) сборка контракта: деплой + демо-лоты + award.
//
//   node scripts/seed-shielded.mjs
//
// Использует артефакт scripts/build-shielded.mjs (их компилятор ssolc) и тот же
// сценарий, что у портируемой сборки: заявки уходят транзакциями типа 0x4A,
// победителя выбирает TEE.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http, encodeFunctionData, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, shieldedWriteContract, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });

const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts-shielded.json'), 'utf8')).BlindBidShielded;
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
const RPC = dep.rpc;
const SUSDC = dep.susdc;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

const pub = createShieldedPublicClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }) });
const main = privateKeyToAccount(process.env.MAIN_PK);
const wallet = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account: main, publicClient: pub });

async function retry(fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e.shortMessage || e.message) + ' ' + String(e.details || '') + ' status=' + String(e.status || '');
      if (!/429|Too Many Requests|rate limit/i.test(msg) || i === tries - 1) throw e;
      console.log('   RPC busy, retry in 20s…');
      await sleep(20000);
    }
  }
}

const susdcAbi = [
  { type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
];

async function send(to, data) {
  const hash = await retry(() => wallet.sendTransaction({ to, data, value: 0n }));
  await retry(() => pub.waitForTransactionReceipt({ hash }));
  return hash;
}

console.log('1) deploy BlindBidShielded (ssolc build)');
const deployHash = await retry(() => wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [] }));
const rc = await retry(() => pub.waitForTransactionReceipt({ hash: deployHash }));
const BB = rc.contractAddress;
console.log('   ->', BB, `(gas ${rc.gasUsed})`);

const create = (title, memo, limit, deadline, sealed) =>
  send(BB, encodeFunctionData({ abi: art.abi, functionName: 'createTender', args: [title, memo, parseUnits(String(limit), 6), BigInt(deadline), sealed] }));

async function bid(pk, tenderId, amount) {
  const account = privateKeyToAccount(pk);
  const w = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account, publicClient: pub });
  const hash = await retry(() => shieldedWriteContract(w, {
    address: BB, abi: art.abi, functionName: 'submitBid', args: [BigInt(tenderId), parseUnits(String(amount), 6)],
  }));
  await retry(() => pub.waitForTransactionReceipt({ hash }));
  return hash;
}

console.log('2) lot #1 — open, three suppliers file sealed bids');
const deadline0 = now() + 90;
await create('Supply of server hardware', 'Bid amounts stay sealed until award', 100, deadline0, false);
const burners = [];
for (const amount of [50, 12, 90]) {
  const pk = generatePrivateKey();
  const acc = privateKeyToAccount(pk);
  await send(SUSDC, encodeFunctionData({ abi: susdcAbi, functionName: 'transfer', args: [acc.address, parseUnits('0.2', 6)] }));
  const h = await bid(pk, 0, amount);
  burners.push({ pk, address: acc.address });
  console.log(`   ${amount} sUSDC sealed, tx ${h.slice(0, 12)}…`);
}

console.log('3) waiting for the bid window to close');
while (now() < deadline0 + 3) await sleep(5000);
const award0 = await send(BB, encodeFunctionData({ abi: art.abi, functionName: 'closeAndAward', args: [0n] }));
console.log('   awarded, tx', award0.slice(0, 14), '…');

console.log('4) lot #2 — open, sealed price');
await create('Confidential audit of a treasury', 'The winning price is not published', 250, now() + 86400, true);

console.log('5) lot #3 — owned by the demo buyer (opens the buyer sheet)');
const accSrc = fs.readFileSync(path.join(ROOT, 'web', 'src', 'demo-accounts.ts'), 'utf8');
const demoKeys = [...accSrc.matchAll(/"pk":\s*"(0x[0-9a-fA-F]{64})"/g)].map((m) => m[1]);
const buyerAcc = privateKeyToAccount(demoKeys[0]);
const bw = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account: buyerAcc, publicClient: pub });
const bwSend = async (data) => {
  const hash = await retry(() => bw.sendTransaction({ to: BB, data, value: 0n }));
  await retry(() => pub.waitForTransactionReceipt({ hash }));
  return hash;
};
const deadline2 = now() + 90;
await bwSend(encodeFunctionData({ abi: art.abi, functionName: 'createTender', args: ['Supply of network switches', 'Amounts stay sealed until the award', parseUnits('200', 6), BigInt(deadline2), false] }));
const h1 = await bid(demoKeys[1], 2, 78);
const h2 = await bid(demoKeys[2], 2, 63);
console.log('   78 sUSDC sealed, tx', h1.slice(0, 12), '…');
console.log('   63 sUSDC sealed, tx', h2.slice(0, 12), '…');
while (now() < deadline2 + 3) await sleep(5000);
const award2 = await bwSend(encodeFunctionData({ abi: art.abi, functionName: 'closeAndAward', args: [2n] }));
console.log('   awarded, tx', award2.slice(0, 14), '…');

dep.contracts.BlindBidShielded = { address: BB, hash: deployHash };
fs.writeFileSync(path.join(ROOT, 'deployments.json'), JSON.stringify(dep, null, 2));

const cfgPath = path.join(ROOT, 'web', 'src', 'config.ts');
let cfg = fs.readFileSync(cfgPath, 'utf8');
if (!/BlindBidShielded:/.test(cfg)) {
  cfg = cfg.replace(/(\n\s*SealStore: '0x[0-9a-fA-F]+',)/, `$1\n  BlindBidShielded: '${BB}',`);
}
fs.writeFileSync(cfgPath, cfg);

console.log('\nBlindBidShielded =', BB);
console.log('updated: deployments.json, web/src/config.ts');
