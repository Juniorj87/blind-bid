// Пополняет демо-аккаунты витрины (web/src/demo-accounts.ts) газом sUSDC.
//   node scripts/fund-demo.mjs            — 0.3 sUSDC на аккаунт
//   FUND_AMOUNT=1 node scripts/fund-demo.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http, encodeFunctionData, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
const accountsSrc = fs.readFileSync(path.join(ROOT, 'web', 'src', 'demo-accounts.ts'), 'utf8');
const keys = [...accountsSrc.matchAll(/"pk":\s*"(0x[0-9a-fA-F]{64})"/g)].map((m) => m[1]);
if (!keys.length) {
  console.error('не найдены ключи в web/src/demo-accounts.ts — сначала npm run seed');
  process.exit(1);
}

const AMOUNT = parseUnits(process.env.FUND_AMOUNT || '0.3', 6);
const main = privateKeyToAccount(process.env.MAIN_PK);
const pub = createShieldedPublicClient({ chain: seismicTestnet, transport: http(dep.rpc, { retryCount: 4, retryDelay: 4000 }) });
const wallet = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(dep.rpc, { retryCount: 4, retryDelay: 4000 }), account: main, publicClient: pub });
const susdcAbi = [
  { type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
];

for (const pk of keys) {
  const to = privateKeyToAccount(pk).address;
  try {
    const hash = await wallet.sendTransaction({
      to: dep.susdc,
      data: encodeFunctionData({ abi: susdcAbi, functionName: 'transfer', args: [to, AMOUNT] }),
      value: 0n,
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`funded ${to} — ${Number(AMOUNT) / 1e6} sUSDC`);
  } catch (e) {
    console.log(`${to} — не удалось: ${String(e.shortMessage || e.message).slice(0, 90)}`);
  }
}
