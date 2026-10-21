// Встроенный кошелёк (embedded wallet): ключ живёт в браузере и подписывает
// в том числе зашифрованные транзакции типа 0x4A — обычный EVM-кошелёк это не умеет.
// Модель та же, что у Privy-встроенных кошельков; для полноценного Privy нужен
// его App ID, точка подключения — здесь (см. README).
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const KEY = 'blindbid.wallets.v1';

export type EmbeddedWallet = {
  id: string;
  label: string;
  pk: string;
  address: string;
  createdAt: number;
};

function read(): EmbeddedWallet[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function write(list: EmbeddedWallet[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function listWallets(): EmbeddedWallet[] {
  return read();
}

export function createWallet(label?: string): EmbeddedWallet {
  const pk = generatePrivateKey();
  const w: EmbeddedWallet = {
    id: pk.slice(2, 10),
    label: label || `wallet ${read().length + 1}`,
    pk,
    address: privateKeyToAccount(pk as `0x${string}`).address,
    createdAt: Date.now(),
  };
  write([...read(), w]);
  return w;
}

export function removeWallet(id: string) {
  write(read().filter((w) => w.id !== id));
}

export function importWallet(pk: string, label?: string): EmbeddedWallet {
  const w: EmbeddedWallet = {
    id: pk.slice(2, 10),
    label: label || 'imported',
    pk,
    address: privateKeyToAccount(pk as `0x${string}`).address,
    createdAt: Date.now(),
  };
  write([...read().filter((x) => x.id !== w.id), w]);
  return w;
}
