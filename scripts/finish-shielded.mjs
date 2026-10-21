// Доделывает сценарий нативной сборки после обрыва (например, из-за 429 на RPC).
//   node scripts/finish-shielded.mjs <contractAddress>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http, encodeFunctionData, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, shieldedWriteContract, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });

const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts-shielded.json'), 'utf8')).BlindBidShielded;
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
const BB = process.argv[2] || dep.contracts.BlindBidShielded?.address;
if (!BB) { console.error('нужен адрес контракта'); process.exit(1); }

const RPC = dep.rpc;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const pub = createShieldedPublicClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }) });

async function retry(fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e.shortMessage || e.message) + ' ' + String(e.details || '') + ' status=' + String(e.status || '');
      if (!/429|Too Many Requests|rate limit|Transaction creation failed|expired|Missing or invalid parameters/i.test(msg) || i === tries - 1) throw e;
      console.log('   RPC busy, retry in 20s…');
      await sleep(20000);
    }
  }
}

const accSrc = fs.readFileSync(path.join(ROOT, 'web', 'src', 'demo-accounts.ts'), 'utf8');
const demoKeys = [...accSrc.matchAll(/"pk":\s*"(0x[0-9a-fA-F]{64})"/g)].map((m) => m[1]);

const client = async (pk) => {
  const account = privateKeyToAccount(pk);
  return createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account, publicClient: pub });
};
const main = await client(process.env.MAIN_PK);
const buyer = await client(demoKeys[0]);

async function send(w, data) {
  const hash = await retry(() => w.sendTransaction({ to: BB, data, value: 0n }));
  await retry(() => pub.waitForTransactionReceipt({ hash }));
  return hash;
}
const create = (w, title, memo, limit, deadline, sealed) =>
  send(w, encodeFunctionData({ abi: art.abi, functionName: 'createTender', args: [title, memo, parseUnits(String(limit), 6), BigInt(deadline), sealed] }));
async function bid(pk, tenderId, amount) {
  // клиент создаётся внутри retry: у sealed-транзакции есть recentBlockHash/expiresAtBlock
  const hash = await retry(async () => {
    const w = await client(pk);
    return shieldedWriteContract(w, {
      address: BB, abi: art.abi, functionName: 'submitBid', args: [BigInt(tenderId), parseUnits(String(amount), 6)],
    });
  });
  await retry(() => pub.waitForTransactionReceipt({ hash }));
  return hash;
}

const count = Number(await pub.readContract({ address: BB, abi: art.abi, functionName: 'tenderCount' }));
console.log('contract', BB, '· lots:', count);

if (count >= 1) {
  const t = await pub.readContract({ address: BB, abi: art.abi, functionName: 'tender', args: [0n] });
  if (t.status === 0) {
    const h = await send(main, encodeFunctionData({ abi: art.abi, functionName: 'closeAndAward', args: [0n] }));
    console.log('lot #1 awarded, tx', h.slice(0, 14), '…');
  }
}

if (count < 2) {
  await create(main, 'Confidential audit of a treasury', 'The winning price is not published', 250, now() + 86400, true);
  console.log('lot #2 — open, sealed price');
}

const plan = [[demoKeys[1], 78], [demoKeys[2], 63]];
if (count < 3) {
  const deadline = now() + 240;
  await create(buyer, 'Supply of network switches', 'Amounts stay sealed until the award', 200, deadline, false);
  console.log('lot #3 — owned by the demo buyer');
}

if (count >= 3) {
  const t3 = await pub.readContract({ address: BB, abi: art.abi, functionName: 'tender', args: [2n] });
  for (let i = Number(t3.bidCount); i < plan.length; i++) {
    const h = await bid(plan[i][0], 2, plan[i][1]);
    console.log(`   ${plan[i][1]} sUSDC sealed, tx ${h.slice(0, 12)}…`);
  }
  const t3b = await pub.readContract({ address: BB, abi: art.abi, functionName: 'tender', args: [2n] });
  while (now() < Number(t3b.deadline) + 3) await sleep(5000);
  if (t3b.status === 0) {
    const h = await send(buyer, encodeFunctionData({ abi: art.abi, functionName: 'closeAndAward', args: [2n] }));
    console.log('   awarded, tx', h.slice(0, 14), '…');
  }
}

dep.contracts.BlindBidShielded = { address: BB, hash: null };
fs.writeFileSync(path.join(ROOT, 'deployments.json'), JSON.stringify(dep, null, 2));
const cfgPath = path.join(ROOT, 'web', 'src', 'config.ts');
let cfg = fs.readFileSync(cfgPath, 'utf8');
cfg = /BlindBidShielded: '0x[0-9a-fA-F]+'/.test(cfg)
  ? cfg.replace(/BlindBidShielded: '0x[0-9a-fA-F]+'/, `BlindBidShielded: '${BB}'`)
  : cfg.replace(/(\n\s*SealStore: '0x[0-9a-fA-F]+',)/, `$1\n  BlindBidShielded: '${BB}',`);
fs.writeFileSync(cfgPath, cfg);
console.log('\nupdated: deployments.json, web/src/config.ts');
