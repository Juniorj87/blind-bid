// Дописывает лот: недостающие заявки и award. Используется, когда RPC отдал 429.
//   node scripts/finish-lot.mjs <tenderId> [amounts...]
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

const tenderId = BigInt(process.argv[2]);
const amounts = process.argv.slice(3).map((a) => parseUnits(a, 6));
const client = async (pk) => {
  const account = privateKeyToAccount(pk);
  return createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account, publicClient: pub });
};

for (const [i, amount] of amounts.entries()) {
  const w = await client(keys[i + 1]);
  const tx = await retry(() => shieldedWriteContract(w, {
    address: BB, abi: art.BlindBid.abi, functionName: 'submitBid', args: [tenderId, amount],
  }));
  await retry(() => pub.waitForTransactionReceipt({ hash: tx }));
  console.log(`bid ${Number(amount) / 1e6} sUSDC sealed, tx ${tx.slice(0, 12)}…`);
}

const t = await pub.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tender', args: [tenderId] });
const deadline = Number(t.deadline);
console.log('window closes in', Math.max(0, deadline - Math.floor(Date.now() / 1000)), 's');
while (Math.floor(Date.now() / 1000) < deadline + 3) await sleep(5000);

const bw = await client(keys[0]);
const award = await retry(() => bw.sendTransaction({
  to: BB,
  data: encodeFunctionData({ abi: art.BlindBid.abi, functionName: 'closeAndAward', args: [tenderId] }),
  value: 0n,
}));
await retry(() => pub.waitForTransactionReceipt({ hash: award }));
console.log('awarded, tx', award.slice(0, 14), '…');
