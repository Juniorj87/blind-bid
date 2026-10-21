// Сборка BlindBid: Yul-библиотека SealStore + Solidity-контракты.
// Артефакты: blind-bid/artifacts.json
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import solc from 'solc';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS = path.join(ROOT, 'contracts');
const OUT = path.join(ROOT, 'artifacts.json');

function compileYul(file) {
  const input = {
    language: 'Yul',
    sources: { [file]: { content: fs.readFileSync(path.join(CONTRACTS, file), 'utf8') } },
    settings: { evmVersion: 'cancun', outputSelection: { '*': { '*': ['evm.bytecode.object'] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  const c = Object.values(out.contracts || {}).flatMap((o) => Object.values(o))[0];
  return { bytecode: '0x' + c.evm.bytecode.object };
}

function compileSolidity(files) {
  const sources = {};
  for (const f of files) sources[f] = { content: fs.readFileSync(path.join(CONTRACTS, f), 'utf8') };
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  const res = {};
  for (const [file, contracts] of Object.entries(out.contracts || {})) {
    for (const [name, c] of Object.entries(contracts)) {
      res[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
    }
  }
  return res;
}

const sealStore = compileYul('SealStore.yul');
const sol = compileSolidity(['BlindBid.sol']);

const artifacts = {
  SealStore: {
    abi: [
      { type: 'function', name: 'store', inputs: [{ name: 'slot', type: 'uint256' }, { name: 'value', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
      { type: 'function', name: 'storeFromTransient', inputs: [{ name: 'slot', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
      { type: 'function', name: 'load', inputs: [{ name: 'slot', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
      { type: 'function', name: 'minSlot', inputs: [{ name: 'slots', type: 'uint256[]' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
      { type: 'function', name: 'sumSlots', inputs: [{ name: 'slots', type: 'uint256[]' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
    ],
    bytecode: sealStore.bytecode,
  },
  ...sol,
};

fs.writeFileSync(OUT, JSON.stringify(artifacts, null, 2));
for (const [n, a] of Object.entries(artifacts)) {
  console.log(`compiled ${n}: ${a.bytecode.length} chars`);
}
console.log('->', OUT);
