// Собирает транзакции контракта из блоков (eth_getLogs на этом RPC не работает)
// и кладёт их в deployments.json → events. Приложение использует их как старт ленты.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http, createPublicClient } from 'viem';
import { seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
const client = createPublicClient({ chain: seismicTestnet, transport: http(dep.rpc, { retryCount: 4, retryDelay: 4000 }) });
const target = dep.contracts.BlindBid.address.toLowerCase();

const FROM = Number(process.env.FROM_BLOCK || 64680800);
const TO = Number(process.env.TO_BLOCK || 64681400);
const STEP = 25;

const found = [];
for (let b = FROM; b <= TO; b += STEP) {
  const batch = [];
  for (let k = 0; k < STEP; k++) {
    const n = b + k;
    batch.push(
      client
        .getBlock({ blockNumber: BigInt(n), includeTransactions: true })
        .then((blk) => {
          for (const tx of blk.transactions) {
            if (tx.to?.toLowerCase() === target || tx.from?.toLowerCase() === target) {
              found.push({ hash: tx.hash, type: tx.type ?? '0x2', block: n });
            }
          }
        })
        .catch(() => {})
    );
  }
  await Promise.all(batch);
  process.stdout.write(`\rscanned ${b + STEP} / ${TO}  found ${found.length}   `);
}
console.log('\nfound', found.length);

found.sort((a, b) => a.block - b.block);
dep.events = found;
fs.writeFileSync(path.join(ROOT, 'deployments.json'), JSON.stringify(dep, null, 2));
console.log('-> deployments.json events:', found.length);
found.forEach((e) => console.log(`  blk ${e.block}  ${e.type}  ${e.hash}`));
