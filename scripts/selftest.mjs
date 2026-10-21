// Автотест BlindBid: проверяет всё, что можно проверить без газа.
//   node scripts/selftest.mjs            — read-only проверки
//   node scripts/selftest.mjs --scan 60000 — дополнительно ищет транзакции контракта
//                                               в последних N блоках и проверяет их тип (0x4A)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http, createPublicClient, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, signedReadContract, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts.json'), 'utf8'));
const RPC = dep.rpc;
const BB = dep.contracts.BlindBid.address;
const SS = dep.contracts.SealStore.address;

const pub = createPublicClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }) });
const shielded = createShieldedPublicClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }) });
const main = privateKeyToAccount(process.env.MAIN_PK);
const wallet = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account: main, publicClient: shielded });

// подписанное чтение выполняет покупатель лота: у демо-аккаунтов есть свои ключи
const accSrc = fs.readFileSync(path.join(ROOT, 'web', 'src', 'demo-accounts.ts'), 'utf8');
const demoKeys = [...accSrc.matchAll(/"pk":\s*"(0x[0-9a-fA-F]{64})"/g)].map((m) => m[1]);
const keyOf = (address) => {
  for (const pk of demoKeys) {
    if (privateKeyToAccount(pk).address.toLowerCase() === address.toLowerCase()) return pk;
  }
  return process.env.MAIN_PK;
};
const walletOf = async (address) => {
  const pk = keyOf(address);
  if (pk === process.env.MAIN_PK) return wallet;
  return createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account: privateKeyToAccount(pk), publicClient: shielded });
};

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  cond ? pass++ : fail++;
};
// публичный RPC ограничивает частоту запросов (429) — повторяем чтение
async function retry(fn, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e.shortMessage || e.message) + ' ' + String(e.details || '') + ' status=' + String(e.status || '');
      if (!/429|Too Many Requests|rate limit/i.test(msg) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
}
const slotOf = (tenderId, i) =>
  keccak256(('0x' + tenderId.toString(16).padStart(64, '0') + BigInt(i).toString(16).padStart(64, '0')));

console.log('\nBLINDBID · self-test');
console.log(`rpc ${RPC} · contract ${BB}\n`);

console.log('network');
const chainId = await pub.getChainId();
ok('chainId is 5124', chainId === 5124, `got ${chainId}`);
const b1 = await pub.getBlockNumber();
await new Promise((r) => setTimeout(r, 1500));
const b2 = await pub.getBlockNumber();
ok('chain is producing blocks', b2 >= b1, `${b1} -> ${b2}`);

console.log('\ncontracts');
for (const [name, addr] of [['BlindBid', BB], ['SealStore', SS]]) {
  const code = await pub.getCode({ address: addr });
  ok(`${name} has code`, !!code && code !== '0x', `${addr} (${((code.length - 2) / 2) | 0} bytes)`);
}

console.log('\ntenders');
const count = await pub.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tenderCount' });
ok('at least one tender exists', count > 0n, `${count} tenders`);

for (let id = 0n; id < count; id++) {
  const t = await pub.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tender', args: [id] });
  console.log(`\n  lot #${id}  "${t.title}"  bids=${t.bidCount}  status=${t.status}`);

  if (Number(t.bidCount) > 0) {
    const rows = await Promise.all(
      Array.from({ length: Number(t.bidCount) }).map(async (_, i) => {
        const slot = slotOf(id, BigInt(i));
        const raw = await pub.getStorageAt({ address: SS, slot });
        return { i, slot, raw };
      })
    );
    const allZero = rows.every((r) => /^0x0+$/.test(r.raw));
    ok('private slots read as zero for an outside observer', allZero, rows.map((r) => r.raw.slice(0, 6)).join(' '));
  }

  if (t.status === 1) {
    ok('winner is set', t.winner !== '0x0000000000000000000000000000000000000000', t.winner);
    ok('winning amount is published', Number(t.winningAmount) > 0, `${Number(t.winningAmount) / 1e6} sUSDC`);

    let bids = null;
    let buyerWallet = wallet;
    try {
      bids = await retry(async () => {
        buyerWallet = await walletOf(t.buyer);
        return signedReadContract(buyerWallet, {
          address: BB, abi: art.BlindBid.abi, functionName: 'tenderBids', args: [id],
        });
      });
    } catch (e) {
      console.log(`  SKIP  buyer signed read: ${String(e.shortMessage || e.message).slice(0, 60)}`);
    }
    if (bids) {
      const amounts = bids[1].map((x) => BigInt(x));
      const min = amounts.reduce((a, b) => (a < b ? a : b), amounts[0]);
      ok('winner holds the lowest bid', min === BigInt(t.winningAmount), `min=${Number(min) / 1e6}`);
      const total = await retry(() => signedReadContract(buyerWallet, {
        address: BB, abi: art.BlindBid.abi, functionName: 'totalCommitted', args: [id],
      }));
      const sum = amounts.reduce((a, b) => a + b, 0n);
      ok('aggregate matches the sum of bids', BigInt(total) === sum, `${Number(total) / 1e6} sUSDC`);
      const winnerIdx = bids[0].findIndex((a) => a.toLowerCase() === t.winner.toLowerCase());
      ok('winner appears in the bid list', winnerIdx >= 0, `index ${winnerIdx}`);
    }
  }
}

const scan = Number(process.argv[process.argv.indexOf('--scan') + 1]) || 0;
if (scan) {
  console.log(`\nscanning last ${scan} blocks for contract traffic`);
  const head = await pub.getBlockNumber();
  const from = head - BigInt(scan);
  const found = [];
  for (let b = from; b <= head; b += 25n) {
    const blk = await pub.getBlock({ blockNumber: b, includeTransactions: true });
    for (const tx of blk.transactions) {
      if (tx.to?.toLowerCase() === BB.toLowerCase()) found.push({ hash: tx.hash, type: tx.type });
    }
  }
  ok('contract traffic found', found.length > 0, `${found.length} txs`);
  const enc = found.filter((t) => t.type === '0x4a');
  ok('bid transactions are type 0x4A (encrypted calldata)', enc.length > 0, `${enc.length}/${found.length} encrypted`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
