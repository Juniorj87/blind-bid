// Клиент Seismic для браузера: burner-аккаунты, shielded-записи, signed reads.
import { http, createPublicClient, encodeFunctionData, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, shieldedWriteContract, seismicTestnet } from 'seismic-viem';
import { BlindBidAbi, CONTRACTS, RPC } from './config';

export const publicClient = createPublicClient({ chain: seismicTestnet, transport: http(RPC) });
export const shieldedPublic = createShieldedPublicClient({ chain: seismicTestnet, transport: http(RPC) });

export type Account = { address: string; privateKey: string; label: string };

export function makeClient(pk: string) {
  const account = privateKeyToAccount(pk as `0x${string}`);
  return createShieldedWalletClient({
    chain: seismicTestnet,
    transport: http(RPC),
    account,
    publicClient: shieldedPublic,
  });
}

export async function readTenders() {
  const n = (await publicClient.readContract({
    address: CONTRACTS.BlindBid as `0x${string}`,
    abi: BlindBidAbi,
    functionName: 'tenderCount',
  })) as bigint;
  const out = [];
  for (let i = 0n; i < n; i++) {
    const t = (await publicClient.readContract({
      address: CONTRACTS.BlindBid as `0x${string}`,
      abi: BlindBidAbi,
      functionName: 'tender',
      args: [i],
    })) as any;
    out.push({ id: i, ...t });
  }
  return out;
}

/** Публичное чтение — то, что видит любой наблюдатель. */
export async function readPublicTender(id: bigint) {
  return (await publicClient.readContract({
    address: CONTRACTS.BlindBid as `0x${string}`,
    abi: BlindBidAbi,
    functionName: 'tender',
    args: [id],
  })) as any;
}

/** Signed read: msg.sender восстанавливается из подписи, поэтому видно «свои» данные.
 *  Браузерный клиент ноду не проходит (тот же дефект, что и у 0x4A-записи),
 *  поэтому подписанное чтение идёт через локальный подписант. */
export async function readAs(pk: string, functionName: string, args: any[]) {
  const r = await writerPost('/read', { functionName, args: args.map(String), pk });
  return r.result;
}

/** Отправка заявки: shielded-запись (тип транзакции 0x4A) — calldata зашифрован. */
export async function submitBid(pk: string, tenderId: bigint, amount: bigint) {
  const client = await makeClient(pk);
  const hash = await shieldedWriteContract(client, {
    address: CONTRACTS.BlindBid as `0x${string}`,
    abi: BlindBidAbi,
    functionName: 'submitBid',
    args: [tenderId, amount],
  } as any);
  await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
  return hash;
}

export async function createTender(pk: string, title: string, memo: string, budget: bigint, deadline: number, sealedPrice: boolean) {
  const client = await makeClient(pk);
  const data = encodeFunctionData({
    abi: BlindBidAbi,
    functionName: 'createTender',
    args: [title, memo, budget, BigInt(deadline), sealedPrice],
  });
  const hash = await client.sendTransaction({ to: CONTRACTS.BlindBid as `0x${string}`, data, value: 0n });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function closeAndAward(pk: string, tenderId: bigint) {
  const client = await makeClient(pk);
  const data = encodeFunctionData({ abi: BlindBidAbi, functionName: 'closeAndAward', args: [tenderId] });
  const hash = await client.sendTransaction({ to: CONTRACTS.BlindBid as `0x${string}`, data, value: 0n });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export function fmt(n: bigint | number, decimals = 6) {
  return (Number(n) / 10 ** decimals).toFixed(2);
}

/* ------------------------------------------------ внешний кошелёк (EIP-1193) */

/** Провайдер браузерного кошелька (MetaMask/Rabby и т.п.), если он есть. */
export function browserProvider(): any {
  return (globalThis as any).ethereum ?? null;
}

/**
 * Клиент внешнего кошелька — только для обычных транзакций (тип 0x2):
 * createTender / closeAndAward. Зашифрованные заявки (тип 0x4A) внешний
 * кошелёк подписать не может — для них нужен локальный ключ.
 */
export async function externalWalletClient(address: string) {
  const { createWalletClient, custom } = await import('viem');
  const provider = browserProvider();
  if (!provider) throw new Error('no browser wallet');
  return createWalletClient({
    account: address as `0x${string}`,
    chain: seismicTestnet,
    transport: custom(provider),
  });
}

/** Слоты приватного хранилища для лота: keccak(abi.encode(tenderId, idx)). */
export function bidSlots(tenderId: bigint, count: number) {
  const out: `0x${string}`[] = [];
  for (let i = 0; i < count; i++) {
    const enc = ('0x' + tenderId.toString(16).padStart(64, '0') + BigInt(i).toString(16).padStart(64, '0')) as `0x${string}`;
    out.push(keccak256(enc));
  }
  return out;
}

/** Сырое чтение приватных слотов — наблюдатель видит нули. */
export async function readPrivateSlots(tenderId: bigint, count: number) {
  console.log('readPrivateSlots', tenderId, count, 'sealStore', CONTRACTS.SealStore);
  const slots = bidSlots(tenderId, count);
  const rows = await Promise.all(
    slots.map(async (slot) => {
      try {
        const raw = await publicClient.getStorageAt({ address: CONTRACTS.SealStore as `0x${string}`, slot });
        return { slot, raw };
      } catch (e) {
        console.error('getStorageAt failed', e);
        return { slot, raw: 'n/a' };
      }
    })
  );
  return rows;
}

export function short(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
}

/* --------------------------------------------- локальный подписант (dev) */

// Браузерная сборка 0x4A-транзакции не совпадает с нодой, поэтому витрина
// отдаёт ключ локальному подписанту (scripts/writer.mjs), а он подписывает в сети.
const WRITER = 'http://127.0.0.1:4181';

export async function writerPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(WRITER + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: 'bad response' }));
  if (!res.ok) throw new Error(String(json.error || 'writer failed'));
  return json as any;
}
