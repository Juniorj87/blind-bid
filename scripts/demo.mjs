// Сквозной демо-сценарий BlindBid:
//   1. заказчик создаёт тендер
//   2. три поставщика подают заявки в зашифрованных транзакциях (тип 0x4A)
//   3. после дедлайна заказчик закрывает тендер — победитель считается внутри TEE
//   4. показываем: что видит наблюдатель / заказчик / победитель
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { http, encodeFunctionData, createPublicClient, parseUnits, keccak256, decodeFunctionResult } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, shieldedWriteContract, signedReadContract, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts.json'), 'utf8'));
const RPC = dep.rpc;
const SUSDC = dep.susdc;
const BB = dep.contracts.BlindBid.address;
const SS = dep.contracts.SealStore.address;
const EXPLORER = dep.explorer;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (n) => (Number(n) / 1e6).toFixed(2);

const buyer = privateKeyToAccount(process.env.MAIN_PK);
const buyerPub = createShieldedPublicClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }) });
const buyerW = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account: buyer, publicClient: buyerPub });
const plain = createPublicClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }) });

const susdcAbi = [
  { type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
];

async function fund(to, amount = 100000n) { // 0.3 sUSDC на газ
  const h = await buyerW.sendTransaction({
    to: SUSDC,
    data: encodeFunctionData({ abi: susdcAbi, functionName: 'transfer', args: [to, amount] }),
    value: 0n,
  });
  await buyerPub.waitForTransactionReceipt({ hash: h });
}

async function rawTxType(hash) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [hash] }),
  });
  return (await r.json()).result?.type;
}

console.log('=== 1. Заказчик создаёт тендер ===');
const deadline = Math.floor(Date.now() / 1000) + 75;
const budget = parseUnits('100', 6);
const createTx = await buyerW.sendTransaction({
  to: BB,
  data: encodeFunctionData({
    abi: art.BlindBid.abi,
    functionName: 'createTender',
    args: ['Поставка серверного оборудования', 'Котировка скрыта до award', budget, BigInt(deadline), false],
  }),
  value: 0n,
});
await buyerPub.waitForTransactionReceipt({ hash: createTx });
const tenderCount = await plain.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tenderCount' });
const tenderId = tenderCount - 1n;
console.log(`   тендер #${tenderId} создан, бюджет ${usd(budget)} sUSDC, дедлайн через 75 сек`);

console.log('\n=== 2. Три поставщика подают заявки (tx типа 0x4A, calldata зашифрован) ===');
const bids = [
  { who: 'Acme Corp', amount: parseUnits('50', 6) },
  { who: 'Globex', amount: parseUnits('12', 6) },
  { who: 'Initech', amount: parseUnits('90', 6) },
];
for (const b of bids) {
  const pk = generatePrivateKey();
  const acc = privateKeyToAccount(pk);
  await fund(acc.address);
  const w = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account: acc, publicClient: buyerPub });
  const hash = await shieldedWriteContract(w, {
    address: BB,
    abi: art.BlindBid.abi,
    functionName: 'submitBid',
    args: [tenderId, b.amount],
  });
  const rc = await buyerPub.waitForTransactionReceipt({ hash });
  console.log(`   ${b.who.padEnd(10)} сумма ${usd(b.amount).padStart(7)} sUSDC | tx type ${await rawTxType(hash)} | ${EXPLORER}/tx/${hash}`);
}

console.log('\n=== 3. Что видит наблюдатель (публичные данные) ===');
const t = await plain.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tender', args: [tenderId] });
console.log(`   заявок: ${t.bidCount} | победитель: ${t.winner} | статус: ${t.status}`);
console.log('   приватные слоты SealStore (сырые значения в блокчейне):');
for (let i = 0; i < 3; i++) {
  const slot = keccak256('0x' + tenderId.toString(16).padStart(64, '0') + i.toString(16).padStart(64, '0'));
  console.log(`     slot ${slot} = ${await plain.getStorageAt({ address: SS, slot })}`);
}
console.log('   → наблюдатель видит только число заявок; суммы в состоянии нулевые');

console.log('\n=== 4. Ждём дедлайн ===');
while (Date.now() / 1000 < deadline + 2) await sleep(5000);
console.log('   дедлайн прошёл');

console.log('\n=== 5. Заказчик закрывает тендер (победитель считается внутри TEE) ===');
const awardTx = await buyerW.sendTransaction({
  to: BB,
  data: encodeFunctionData({ abi: art.BlindBid.abi, functionName: 'closeAndAward', args: [tenderId] }),
  value: 0n,
});
await buyerPub.waitForTransactionReceipt({ hash: awardTx });
const t2 = await plain.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tender', args: [tenderId] });
console.log(`   победитель: ${t2.winner} | сумма: ${usd(t2.winningAmount)} sUSDC`);

console.log('\n=== 6. Вид заказчика: все заявки расшифрованы только ему ===');
// На Seismic eth_call не применяет `from` — msg.sender там восстанавливается из подписи,
// поэтому чтение «от лица заказчика» — это signed read (seismic-viem).
const [bidders, amounts] = await signedReadContract(buyerW, {
  address: BB,
  abi: art.BlindBid.abi,
  functionName: 'tenderBids',
  args: [tenderId],
});
bidders.forEach((b, i) => console.log(`   ${b} -> ${usd(amounts[i])} sUSDC`));

console.log('\n=== 7. Агрегат для аудита (сумма всех заявок, без раскрытия) ===');
const total = await signedReadContract(buyerW, {
  address: BB,
  abi: art.BlindBid.abi,
  functionName: 'totalCommitted',
  args: [tenderId],
});
console.log(`   totalCommitted = ${usd(total)} sUSDC`);

console.log('\n=== 7. Итог ===');
console.log(`   контракт: ${EXPLORER}/address/${BB}`);
console.log(`   приватное хранилище: ${EXPLORER}/address/${SS}`);
console.log(`   tx award: ${EXPLORER}/tx/${awardTx}`);
