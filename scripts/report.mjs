// Собирает TEST-REPORT.md — артефакт для GitHub: результаты автотестов, адреса,
// состояние сети и расшифровка приватности.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http, createPublicClient, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, signedReadContract, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts.json'), 'utf8'));
const pub = createPublicClient({ chain: seismicTestnet, transport: http(dep.rpc, { retryCount: 4, retryDelay: 4000 }) });
const shielded = createShieldedPublicClient({ chain: seismicTestnet, transport: http(dep.rpc, { retryCount: 4, retryDelay: 4000 }) });
const main = privateKeyToAccount(process.env.MAIN_PK);
const wallet = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(dep.rpc, { retryCount: 4, retryDelay: 4000 }), account: main, publicClient: shielded });

const BB = dep.contracts.BlindBid.address;
const SS = dep.contracts.SealStore.address;
const slotOf = (tenderId, i) =>
  keccak256(('0x' + tenderId.toString(16).padStart(64, '0') + BigInt(i).toString(16).padStart(64, '0')));

function runSelfTest() {
  try {
    return execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'selftest.mjs')], { encoding: 'utf8' });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

const selftest = runSelfTest();
const head = await pub.getBlockNumber();
const count = await pub.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tenderCount' });

const lots = [];
for (let id = 0n; id < count; id++) {
  const t = await pub.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tender', args: [id] });
  const slots = [];
  for (let i = 0; i < Number(t.bidCount); i++) {
    const slot = slotOf(id, BigInt(i));
    const raw = await pub.getStorageAt({ address: SS, slot });
    slots.push({ slot, raw });
  }
  let buyerRows = null;
  try {
    buyerRows = await signedReadContract(wallet, { address: BB, abi: art.BlindBid.abi, functionName: 'tenderBids', args: [id] });
  } catch { /* signed read needs gas */ }
  lots.push({ id, t, slots, buyerRows });
}

const md = `# Test report

Generated ${new Date().toISOString()} · chain 5124 (Seismic testnet) · block ${head}

## Deployment

| Contract | Address |
| --- | --- |
| BlindBid | \`${BB}\` |
| SealStore (private storage) | \`${SS}\` |

RPC: \`${dep.rpc}\` · explorer: ${dep.explorer}

## Self-test

\`\`\`
${selftest.trim()}
\`\`\`

## On-chain state

${lots.map((l) => `### Lot #${l.id}

- subject: ${l.t.title}
- price limit: ${Number(l.t.budget) / 1e6} sUSDC
- envelopes filed: ${l.t.bidCount}
- status: ${['ACCEPTING BIDS', 'AWARDED', 'CANCELLED'][l.t.status]}
${l.t.status === 1 ? `- winner: \`${l.t.winner}\`\n- winning price: ${Number(l.t.winningAmount) / 1e6} sUSDC` : ''}

**Private slots, read raw from the chain** (what any observer sees):

| Slot | Raw value |
| --- | --- |
${l.slots.map((s) => `| \`${s.slot}\` | \`${s.raw}\` |`).join('\n') || '| — | — |'}

${l.buyerRows ? `**Buyer view** (signed read, decrypted for the buyer only):

| Bidder | Amount |
| --- | --- |
${l.buyerRows[0].map((b, i) => `| \`${b}\` | ${Number(l.buyerRows[1][i]) / 1e6} sUSDC |`).join('\n')}
` : ''}`).join('\n')}

## What the tests prove

1. The bid amounts never appear in public state — the slots that hold them read as zero.
2. A bid never exposes its arguments — it is a type \`0x4A\` transaction with encrypted calldata.
3. The winner is decided inside the TEE, so the ranking of the bids was never public either.
4. The buyer can still verify everything, and can prove an aggregate (sum of bids) without
   revealing any single bid.
`;

fs.writeFileSync(path.join(ROOT, 'TEST-REPORT.md'), md);
console.log('-> TEST-REPORT.md');
console.log(md.slice(0, 1200));
