// Демо-лот, принадлежащий демо-покупателю: витрина открывает buyer sheet
// (подписанное чтение) только для лота, где вызывающий — покупатель.
//
//   node scripts/seed-buyer-lot.mjs
//
// Создаёт лот от DEMO_ACCOUNTS[0] (Buyer), два зашифрованных конверта
// от DEMO_ACCOUNTS[1] и [2] и разыгрывает его после закрытия окна.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http, encodeFunctionData, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, shieldedWriteContract, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });

const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts.json'), 'utf8'));
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
const accSrc = fs.readFileSync(path.join(ROOT, 'web', 'src', 'demo-accounts.ts'), 'utf8');
const keys = [...accSrc.matchAll(/"pk":\s*"(0x[0-9a-fA-F]{64})"/g)].map((m) => m[1]);
if (keys.length < 3) { console.error('нужны три демо-аккаунта (npm run seed)'); process.exit(1); }

const RPC = dep.rpc;
const BB = dep.contracts.BlindBid.address;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pub = createShieldedPublicClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }) });

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

const client = async (pk) => {
  const account = privateKeyToAccount(pk);
  return createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account, publicClient: pub });
};

const buyer = keys[0];
const buyerAcc = privateKeyToAccount(buyer);
const bw = await client(buyer);

const tenderCount = await pub.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tenderCount' });
const tenderId = BigInt(tenderCount);

console.log(`lot #${tenderId} — owned by the demo buyer ${buyerAcc.address}`);

const hash = await retry(() => bw.sendTransaction({
  to: BB,
  data: encodeFunctionData({
    abi: art.BlindBid.abi,
    functionName: 'createTender',
    args: [process.env.LOT_TITLE || 'Supply of network switches', 'Amounts stay sealed until the award', parseUnits(process.env.LOT_LIMIT || '200', 6), BigInt(Math.floor(Date.now() / 1000) + Number(process.env.LOT_WINDOW || 90)), false],
  }),
  value: 0n,
}));
await retry(() => pub.waitForTransactionReceipt({ hash }));
console.log('  opened, tx', hash.slice(0, 14), '…');

for (const [i, amount] of (process.env.LOT_BIDS || '78,63').split(',').map(Number).entries()) {
  const w = await client(keys[i + 1]);
  const tx = await retry(() => shieldedWriteContract(w, {
    address: BB, abi: art.BlindBid.abi, functionName: 'submitBid', args: [tenderId, parseUnits(String(amount), 6)],
  }));
  await retry(() => pub.waitForTransactionReceipt({ hash: tx }));
  console.log(`  bid ${amount} sUSDC sealed, tx ${tx.slice(0, 12)}…`);
}

console.log('  waiting for the bid window to close');
const deadline = Number((await pub.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tender', args: [tenderId] })).deadline);
while (Math.floor(Date.now() / 1000) < deadline + 3) await sleep(5000);

const award = await retry(() => bw.sendTransaction({
  to: BB,
  data: encodeFunctionData({ abi: art.BlindBid.abi, functionName: 'closeAndAward', args: [tenderId] }),
  value: 0n,
}));
await retry(() => pub.waitForTransactionReceipt({ hash: award }));
console.log('  awarded, tx', award.slice(0, 14), '…');
console.log('\nthe buyer sheet now opens for lot #' + tenderId + ' with the demo buyer key');
