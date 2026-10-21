import fs from 'fs';
// Локальный подписант для витрины: браузерный путь шифрования у клиента
// не совпадает с нодой (в node — работает), поэтому браузер отдаёт ключ,
// а этот сервер собирает и подписывает 0x4A-транзакцию.
//
//   node scripts/writer.mjs            — http://localhost:4181
//   POST /bid   { tenderId, amount, pk }
//   POST /award { tenderId, pk }
//   POST /lot   { title, limit, window, pk }
import nodeHttp from 'node:http';
import path from 'path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { encodeFunctionData, parseUnits, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createShieldedWalletClient, createShieldedPublicClient, shieldedWriteContract, signedReadContract, seismicTestnet } from 'seismic-viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '..', '.env') });
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts-shielded.json'), 'utf8'));

const RPC = dep.rpc;
const BB = dep.contracts.BlindBid.address;
const pub = createShieldedPublicClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }) });

const PORT = Number(process.env.WRITER_PORT || 4181);

async function clientFor(pk) {
  const account = privateKeyToAccount(pk);
  return createShieldedWalletClient({ chain: seismicTestnet, transport: http(RPC, { retryCount: 4, retryDelay: 4000 }), account, publicClient: pub });
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

const server = nodeHttp.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST,GET' }); return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  let raw = '';
  for await (const c of req) raw += c;
  let body; try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'bad json' }); }

  try {
    const pk = body.pk;
    if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) return json(res, 400, { error: 'pk required' });
    const client = await clientFor(pk);

    if (req.url.startsWith('/bid')) {
      const amount = BigInt(Math.round(Number(body.amount) * 1e6));
      const hash = await shieldedWriteContract(client, {
        address: BB, abi: art.BlindBid.abi, functionName: 'submitBid', args: [BigInt(body.tenderId), amount],
      });
      const rc = await pub.waitForTransactionReceipt({ hash });
      return json(res, 200, { hash, status: rc.status, gasUsed: Number(rc.gasUsed) });
    }

    if (req.url.startsWith('/read')) {
      // подписанное чтение: msg.sender восстанавливается из подписи
      let result;
      for (let i = 0; i < 4; i++) {
        try {
          result = await signedReadContract(await clientFor(pk), {
            address: BB,
            abi: art.BlindBid.abi,
            functionName: body.functionName,
            args: (body.args || []).map((a) => BigInt(a)),
          });
          break;
        } catch (e) {
          const m = String(e.shortMessage || e.message) + ' ' + String(e.details || '') + ' status=' + String(e.status || '');
          if (!/429|Too Many Requests|rate limit|Missing or invalid parameters|expired/i.test(m) || i === 3) throw e;
          await new Promise((r) => setTimeout(r, 6000));
        }
      }
      return json(res, 200, { result: JSON.parse(JSON.stringify(result, (k, v) => (typeof v === 'bigint' ? v.toString() : v))) });
    }

    if (req.url.startsWith('/award')) {
      const data = encodeFunctionData({ abi: art.BlindBid.abi, functionName: 'closeAndAward', args: [BigInt(body.tenderId)] });
      const hash = await client.sendTransaction({ to: BB, data, value: 0n });
      const rc = await pub.waitForTransactionReceipt({ hash });
      return json(res, 200, { hash, status: rc.status, gasUsed: Number(rc.gasUsed) });
    }

    if (req.url.startsWith('/lot')) {
      const data = encodeFunctionData({
        abi: art.BlindBid.abi, functionName: 'createTender',
        args: [body.title || 'Supply of server hardware', 'Bid amounts stay sealed until award',
          parseUnits(String(body.limit || 100), 6), BigInt(Math.floor(Date.now() / 1000) + Number(body.window || 600)), false],
      });
      const hash = await client.sendTransaction({ to: BB, data, value: 0n });
      const rc = await pub.waitForTransactionReceipt({ hash });
      return json(res, 200, { hash, status: rc.status, gasUsed: Number(rc.gasUsed) });
    }

    return json(res, 404, { error: 'unknown endpoint' });
  } catch (e) {
    return json(res, 500, { error: String(e.shortMessage || e.message).slice(0, 200), details: String(e.details || '').slice(0, 200) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`writer on http://127.0.0.1:${PORT}  (contract ${BB})`);
});
