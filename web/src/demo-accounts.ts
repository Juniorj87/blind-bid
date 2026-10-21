// ДЕМО-АККАУНТЫ ТЕСТНЕТА — burner-ключи с тестовыми sUSDC, ценности не имеют.
// Сгенерированы scripts/seed-english.mjs; пополняются через scripts/fund-demo.mjs.
import { privateKeyToAccount } from 'viem/accounts';

const KEYS = [
  {
    "label": "Buyer (demo)",
    "pk": "0x4edcb5c0a654ba227b52ba0147f268a2fcada9e93a6d80ee0438480a17860b72"
  },
  {
    "label": "Supplier (demo)",
    "pk": "0xd12117cb52699f687ce336af09bad5763e427ec3b736be19cc325580ba5a4d16"
  },
  {
    "label": "Supplier B (demo)",
    "pk": "0x404c5d1e26225084f3de9a6e1e3309919f1502d86aa2504f1172f3bf34d53c8f"
  }
];

export const DEMO_ACCOUNTS = KEYS.map((k) => ({ ...k, address: privateKeyToAccount(k.pk as `0x${string}`).address }));
