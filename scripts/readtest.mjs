import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'node:url'; import dotenv from 'dotenv';
import { http, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, signedReadContract, seismicTestnet } from 'seismic-viem';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });
const dep = JSON.parse(fs.readFileSync(path.join(ROOT,'deployments.json'),'utf8'));
const art = JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts.json'),'utf8'));
const plain = createPublicClient({ chain: seismicTestnet, transport: http(dep.rpc, { retryCount: 4, retryDelay: 4000 }) });
const account = privateKeyToAccount(process.env.MAIN_PK);
const pub = createShieldedPublicClient({ chain: seismicTestnet, transport: http(dep.rpc, { retryCount: 4, retryDelay: 4000 }) });
const w = await createShieldedWalletClient({ chain: seismicTestnet, transport: http(dep.rpc, { retryCount: 4, retryDelay: 4000 }), account, publicClient: pub });
const BB = dep.contracts.BlindBid.address;
const n = await plain.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tenderCount' });
console.log('тендеров:', n.toString());
for (let id = 0n; id < n; id++) {
  const t = await plain.readContract({ address: BB, abi: art.BlindBid.abi, functionName: 'tender', args: [id] });
  console.log(`\n--- тендер #${id}: заявок=${t.bidCount} победитель=${t.winner} сумма=${t.winningAmount} статус=${t.status}`);
  try {
    const [bidders, amounts] = await signedReadContract(w, { abi: art.BlindBid.abi, functionName: 'tenderBids', args: [id], address: BB });
    bidders.forEach((b,i)=>console.log(`    ${b} -> ${Number(amounts[i])/1e6} sUSDC`));
    const total = await signedReadContract(w, { abi: art.BlindBid.abi, functionName: 'totalCommitted', args: [id], address: BB });
    console.log(`    totalCommitted = ${Number(total)/1e6} sUSDC`);
  } catch(e){ console.log('    signed read ERR:', (e.shortMessage||e.message).slice(0,120)); }
}
