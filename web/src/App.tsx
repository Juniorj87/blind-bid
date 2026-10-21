import { useEffect, useMemo, useState } from 'react';
import {
  browserProvider, externalWalletClient, fmt, publicClient,
  readAs, readPrivateSlots, readTenders, short, submitBid, writerPost,
} from './chain';
import { CONTRACTS, EXPLORER, BlindBidAbi } from './config';
import { seismicTestnet } from 'seismic-viem';
import { DEMO_ACCOUNTS } from './demo-accounts';
import { createWallet, listWallets, removeWallet, type EmbeddedWallet } from './embedded-wallet';

type Role = 'observer' | 'buyer' | 'supplier';

const STATE = ['ACCEPTING BIDS', 'AWARDED', 'CANCELLED'];

function Corners({ c = 'var(--accent)' }: { c?: string }) {
  return (
    <>
      <i className="c tl" style={{ borderColor: c }} />
      <i className="c tr" style={{ borderColor: c }} />
      <i className="c bl" style={{ borderColor: c }} />
      <i className="c br" style={{ borderColor: c }} />
    </>
  );
}

function Halftone() {
  return (
    <svg className="halftone" viewBox="0 0 420 340" aria-hidden>
      <defs>
        <pattern id="dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="2.4" cy="2.4" r="2" fill="currentColor" />
        </pattern>
      </defs>
      <g fill="url(#dots)"><path d="M70 120 L210 50 L350 120 L350 232 L70 232 Z" /></g>
      <path d="M70 120 L210 212 L350 120" fill="none" stroke="currentColor" strokeWidth="1.3" opacity=".9" />
      <circle cx="210" cy="168" r="32" fill="none" stroke="var(--accent-2)" strokeWidth="2" />
      <circle cx="210" cy="168" r="9" fill="var(--accent-2)" />
      <path d="M20 286 H400" stroke="currentColor" strokeWidth="1" strokeDasharray="4 7" opacity=".45" />
      <path d="M40 268 V300 M110 268 V300 M180 268 V300 M250 268 V300 M320 268 V300" stroke="currentColor" strokeWidth="1" opacity=".35" />
    </svg>
  );
}

function stamp(ts: number) {
  return new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase();
}

function countdown(deadline: number) {
  const s = deadline - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'CLOSED';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}H ${m}M` : `${m}M`;
}

export default function App() {
  const [role, setRole] = useState<Role>('observer');
  const [tenders, setTenders] = useState<any[]>([]);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<string[]>([]);
  const [chain, setChain] = useState<any[]>([]);
  const [slots, setSlots] = useState<any[]>([]);
  const [block, setBlock] = useState<bigint>(0n);
  const [ownKey, setOwnKey] = useState('');
  const [extAddr, setExtAddr] = useState<string | null>(null);
  const [wallets, setWallets] = useState<EmbeddedWallet[]>([]);
  const [walletId, setWalletId] = useState<string | null>(null);

  useEffect(() => { setWallets(listWallets()); }, []);
  const [buyerView, setBuyerView] = useState<any>(null);
  const [myBid, setMyBid] = useState<any>(null);
  const [buyerError, setBuyerError] = useState(false);

  const accounts = useMemo(() => {
    const w = wallets.find((x) => x.id === walletId);
    const base = ownKey ? [{ label: 'own key', pk: ownKey, address: '' }] : DEMO_ACCOUNTS;
    return w ? [{ label: w.label, pk: w.pk, address: w.address }, ...base] : base;
  }, [ownKey, wallets, walletId]);
  const buyer = accounts[0];
  const supplier = accounts[1] ?? accounts[0];

  const say = (m: string) => setFeed((f) => [m, ...f].slice(0, 6));

  async function refresh() {
    try { setTenders(await readTenders()); } catch (e: any) { say('rpc: ' + (e.shortMessage || e.message).slice(0, 80)); }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let last = 0n;
    const target = CONTRACTS.BlindBid.toLowerCase();
    const tick = async () => {
      try {
        const bn = await publicClient.getBlockNumber();
        setBlock(bn);
        if (!last) { last = bn; return; }
        for (let b = last + 1n; b <= bn && b > last - 40n; b++) {
          const blk: any = await publicClient.getBlock({ blockNumber: b, includeTransactions: true });
          for (const tx of blk.transactions) {
            if (tx.to?.toLowerCase() === target || tx.from?.toLowerCase() === target) {
              setChain((c) => [{ hash: tx.hash, type: tx.type ?? '0x2', block: b.toString() }, ...c].slice(0, 16));
            }
          }
        }
        last = bn;
      } catch { /* ignore */ }
    };
    const t = setInterval(tick, 3500);
    tick();
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setBuyerView(null); setMyBid(null); setBuyerError(false); setSlots([]);
    if (selected === null) return;
    (async () => { try { setSlots(await readPrivateSlots(selected, 3)); } catch { setSlots([]); } })();
    (async () => {
      try { setBuyerView(await readAs(buyer.pk, 'tenderBids', [selected])); } catch { setBuyerError(true); }
      try { setMyBid(await readAs(supplier.pk, 'myBid', [selected, 0n])); } catch { /* no gas */ }
    })();
  }, [selected, buyer.pk, supplier.pk]);

  const t = selected !== null ? tenders.find((x) => x.id === selected) : null;
  const now = Math.floor(Date.now() / 1000);
  const left = t ? Number(t.deadline) - now : 0;
  const open = t ? t.status === 0 && left > 0 : false;

  const step = !t ? 0 : t.status === 1 ? 3 : role === 'supplier' ? 1 : 2;
  const steps = [
    { n: '01', label: 'PICK A LOT', hint: 'choose a lot on the left', act: () => {} },
    { n: '02', label: 'FILE A SEALED BID', hint: 'switch to SUPPLIER and seal your price', act: () => setRole('supplier') },
    { n: '03', label: 'AWARD THE LOT', hint: open ? `window closes ${stamp(Number(t!.deadline))} — then open the envelopes` : 'now: BUYER SHEET → open envelopes & award', act: () => setRole('buyer') },
    { n: '04', label: 'DONE', hint: 'winner recorded on-chain', act: () => {} },
  ];

  function newWallet() {
    const w = createWallet();
    setWallets(listWallets());
    setWalletId(w.id);
    say('embedded wallet created: ' + short(w.address));
  }

  function dropWallet(id: string) {
    removeWallet(id);
    setWallets(listWallets());
    if (walletId === id) setWalletId(null);
  }

  async function connectWallet() {
    const p = browserProvider();
    if (!p) { say('no browser wallet found — install MetaMask or use the local key'); return; }
    try {
      const [a] = await p.request({ method: 'eth_requestAccounts' });
      setExtAddr(a);
      say('wallet connected: ' + short(a));
    } catch (e: any) { say('wallet: ' + String(e.message).slice(0, 80)); }
  }

  /** Обычная транзакция: внешним кошельком, если подключён, иначе локальным ключом. */
  async function plainTx(to: string, data: string) {
    if (extAddr) {
      const w = await externalWalletClient(extAddr);
      const hash = await w.sendTransaction({ to: to as `0x${string}`, data: data as `0x${string}`, value: 0n, chain: seismicTestnet });
      await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
      return hash;
    }
    const { encodeFunctionData } = await import('viem');
    throw new Error('connect a wallet first');
  }

  async function openTender() {
    const title = (document.getElementById('t-title') as HTMLInputElement).value || 'Supply of server hardware';
    const limit = (document.getElementById('t-limit') as HTMLInputElement).value || '100';
    const mins = Number((document.getElementById('t-mins') as HTMLInputElement).value || 10);
    setBusy(true);
    try {
      const r = await writerPost('/lot', { title, limit: Number(limit), window: mins * 60, pk: buyer.pk });
      say(`tender opened · ${r.hash.slice(0, 12)}…`);
      await refresh();
    } catch (e: any) { say('rejected: ' + (e.shortMessage || e.message).slice(0, 110)); }
    setBusy(false);
  }

  async function sendBid() {
    const amount = (document.getElementById('b-amount') as HTMLInputElement).value || '50';
    if (selected === null) return;
    setBusy(true);
    try {
      const r = await writerPost('/bid', { tenderId: Number(selected), amount: Number(amount), pk: supplier.pk });
      say(`envelope sealed · tx 0x4A · ${r.hash.slice(0, 12)}…`);
      await refresh();
    } catch (e: any) { console.error('BID FAIL', e); say('rejected: ' + (e.shortMessage || e.message).slice(0, 110) + ' || ' + String(e.details || e.cause?.message || '').slice(0, 160)); }
    setBusy(false);
  }

  async function award() {
    if (selected === null) return;
    setBusy(true);
    try {
      const r = await writerPost('/award', { tenderId: Number(selected), pk: buyer.pk });
      say(`envelopes opened · winner recorded · ${r.hash.slice(0, 12)}…`);
      await refresh();
    } catch (e: any) { say('rejected: ' + (e.shortMessage || e.message).slice(0, 110)); }
    setBusy(false);
  }

  const ROLE_LABEL: Record<Role, string> = { observer: 'PUBLIC SHEET', buyer: 'BUYER SHEET', supplier: 'SUPPLIER' };

  return (
    <div className="app">
      <header className="top">
        <div className="logo">
          <span className="tri" />
          <span className="word">BLINDBID</span>
          <span className="tag">· SEALED TENDER · SEISMIC TESTNET</span>
        </div>

        <nav className="modes">
          {(['observer', 'buyer', 'supplier'] as Role[]).map((r) => (
            <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>
              {ROLE_LABEL[r]} <span className="caret">▾</span>
            </button>
          ))}
        </nav>

        <div className="right">
          <span className="chip"><Corners /><i className="dot" /> CHAIN 5124 · TESTNET-1</span>
          <span className="chip ghost">{stamp(now)}</span>
          <button className="chip wallet" onClick={connectWallet}>
            {extAddr ? short(extAddr) : 'CONNECT WALLET'}
          </button>
        </div>
      </header>

      <div className="dash">
        <section className="lots">
          <div className="lots-head">
            <span className="lbl">LOTS</span>
            <span className="lbl right">{tenders.length} OPEN</span>
          </div>
          <div className="rows">
            {tenders.length === 0 && <div className="hint-line">no lots yet — open one from the BUYER SHEET</div>}
            {tenders.map((x) => (
              <button key={x.id.toString()} className={`lot ${selected === x.id ? 'on' : ''}`} onClick={() => setSelected(x.id)}>
                <div className="lot-top">
                  <span className="lotno">#{String(Number(x.id) + 1).padStart(2, '0')}</span>
                  {(role === 'buyer' ? buyer : supplier).address.toLowerCase() === x.buyer?.toLowerCase() && <span className="mine">YOUR LOT</span>}
                  <span className={`state s${x.status}`}>{STATE[x.status]}</span>
                </div>
                <div className="lot-title">{x.title}</div>
                <div className="lot-foot">
                  <span className="mono">{fmt(x.budget)} sUSDC</span>
                  <span className="mono dim">{x.status === 0 ? countdown(Number(x.deadline)) : '—'}</span>
                  <span className="envs">
                    {Array.from({ length: Number(x.bidCount) }).map((_, i) => (
                      <i key={i} className={x.status === 1 && i === 0 ? 'env open' : 'env'} />
                    ))}
                    <b>{x.bidCount}</b>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="workspace">
          {!t ? (
            <div className="hero">
              <div className="hero-text">
                <div className="lot-label">SEALED TENDER · SEISMIC TESTNET</div>
                <h1 className="hero-title">SEALED BIDS<br />ON SEISMIC</h1>
                <p className="hero-lead">
                  Every bid travels as a type <b>0x4A</b> transaction — the calldata is encrypted and the
                  price lands in a private slot. The chain shows how many envelopes were filed, never
                  what is inside them.
                </p>
                <div className="cta-row">
                  <button className="cta cornered" onClick={() => setRole('buyer')}><Corners c="#12000d" />OPEN A LOT →</button>
                </div>
                <div className="features">
                  <div><span className="fname">ENCRYPTED IN TRANSIT</span><span className="fdesc">type 0x4A — the call and its arguments are unreadable on-chain</span></div>
                  <div><span className="fname">PRIVATE STORAGE</span><span className="fdesc">CSTORE slots are flagged private — raw storage reads as zero</span></div>
                  <div><span className="fname">AWARDED IN THE TEE</span><span className="fdesc">the ranking of bids never existed in public state</span></div>
                </div>
              </div>
              <div className="hero-art">
                <Halftone />
                <div className="art-cap">SEALED · UNREADABLE · UNRANKED</div>
              </div>
            </div>
          ) : (
            <div className="work">
              <div className="doc">
                <div className="sheet-head">
                  <div>
                    <div className="lot-label">LOT #{String(Number(t.id) + 1).padStart(2, '0')}</div>
                    <h1 className="doc-title">{t.title}</h1>
                    <div className="sub">bids close {stamp(Number(t.deadline))} · {t.status === 0 ? (open ? 'ACCEPTING BIDS' : 'WINDOW CLOSED — READY TO AWARD') : 'CLOSED'}</div>
                  </div>
                  {t.status === 1 && <div className="wax"><span>AWARDED</span></div>}
                </div>

                <div className="facts">
                  <div><dt>PRICE LIMIT</dt><dd>{fmt(t.budget)} <i>sUSDC</i></dd></div>
                  <div><dt>ENVELOPES</dt><dd>{t.bidCount}</dd></div>
                  <div><dt>WINNER</dt><dd className="mono">{t.status === 1 ? t.winner : '—'}</dd></div>
                  <div>
                    <dt>WINNING PRICE</dt>
                    <dd>{t.status === 1 && t.priceRevealed ? <span className="strong">{fmt(t.winningAmount)} <i>sUSDC</i></span> : <span className="redact" />}</dd>
                  </div>
                </div>

                {role === 'observer' && (
                  <div className="pane">
                    <div className="pane-label">PUBLIC SHEET — WHAT THE CHAIN SHOWS</div>
                    <div className="redacted"><span className="redact wide" /><span className="redact wide" /><span className="redact half" /></div>
                    <p className="note">
                      Envelope count and deadline only. Amounts sit in slots flagged private — raw storage
                      reads as zero, and the bid transactions are encrypted.
                    </p>
                  </div>
                )}

                {role === 'buyer' && (
                  <div className="pane">
                    <div className="pane-label">BUYER SHEET — SIGNED READ</div>
                    {buyerView ? (
                      <table className="bids">
                        <tbody>
                          {buyerView[0].map((b: string, i: number) => (
                            <tr key={b}><td className="mono">{b}</td><td className="num strong">{fmt(buyerView[1][i])} sUSDC</td></tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="note">
                        {buyerError
                          ? 'The signed read runs in the local signer — start it with `npm run writer` (127.0.0.1:4181).'
                          : 'Opens once the bid window closes.'}
                      </p>
                    )}
                    {t.status === 0 && (
                      <button className="cta cornered" disabled={busy || left > 0} onClick={award}>
                        {left > 0 ? `CLOSES ${stamp(Number(t.deadline))}` : 'OPEN ENVELOPES & AWARD'}
                      </button>
                    )}
                    {t.status === 1 && t.priceRevealed && <p className="verdict">WINNING PRICE — {fmt(t.winningAmount)} sUSDC</p>}
                  </div>
                )}

                {role === 'supplier' && (
                  <div className="pane">
                    <div className="pane-label">SUPPLIER — FILE A SEALED BID</div>
                    <div className="entry">
                      <label>YOUR PRICE, sUSDC</label>
                      <input id="b-amount" defaultValue="50" />
                      <button className="cta cornered" disabled={busy || t.status !== 0} onClick={sendBid}>SEAL &amp; FILE</button>
                    </div>
                    {myBid !== null && myBid !== undefined && <p className="verdict">YOUR ENVELOPE — {fmt(myBid)} sUSDC, visible to you alone</p>}
                    <p className="note">
                      Sealed bids are signed locally with the acting key — the calldata is encrypted into a
                      type 0x4A transaction, so the price never shows up in the mempool.
                    </p>
                  </div>
                )}

                <div className="sheet-foot">
                  <span>CONTRACT <a href={`${EXPLORER}/address/${CONTRACTS.BlindBid}`} target="_blank" rel="noreferrer">[ {CONTRACTS.BlindBid.slice(0, 10)}… ]</a></span>
                  <span>ACTING AS <span className="mono">{role === 'observer' ? '—' : short((role === 'buyer' ? buyer : supplier).address)}</span></span>
                </div>
              </div>

              <div className="live">
                <div className="pane-label">PRIVATE SLOTS — RAW CHAIN READ</div>
                <div className="slots">
                  {slots.length === 0 && <p className="note">no bids filed on this lot yet</p>}
                  {slots.map((s) => (
                    <div key={s.slot} className="slot">
                      <span className="slot-hash mono">{s.slot.slice(0, 14)}…</span>
                      <span className="slot-raw mono">{s.raw.slice(0, 12)}…</span>
                    </div>
                  ))}
                </div>
                <p className="note">
                  These slots hold the bid amounts. The chain returns zeros to every observer — the value
                  only exists inside the TEE.
                </p>

                <div className="pane-label spaced">LIVE CHAIN — CONTRACT TRAFFIC <span className="blk">#{block.toString()}</span></div>
                <div className="live-list">
                  {chain.length === 0 && <p className="note">watching for new transactions…</p>}
                  {chain.map((c) => (
                    <a key={c.hash} className="tx" href={`${EXPLORER}/tx/${c.hash}`} target="_blank" rel="noreferrer">
                      <span className={`tx-type ${c.type === '0x4a' ? 'enc' : ''}`}>{c.type === '0x4a' ? '0x4A' : c.type}</span>
                      <span className="tx-hash mono">{short(c.hash)}</span>
                      <span className="tx-blk mono dim">#{c.block}</span>
                    </a>
                  ))}
                </div>
                <div className="live-art"><Halftone /></div>
              </div>
            </div>
          )}
        </section>

        <aside className="rail">
          <div className="howto">
            <div className="pane-label">HOW IT WORKS</div>
            {steps.map((s, i) => (
              <button key={s.n} className={`step ${i === step ? 'now' : ''} ${i < step ? 'done' : ''}`} onClick={s.act}>
                <span className="sno">{s.n}</span>
                <span className="sbody"><span className="slabel">{s.label}</span><span className="shint">{s.hint}</span></span>
              </button>
            ))}
          </div>

          <div className="rail-block">
            <div className="pane-label">EMBEDDED WALLETS</div>
            <div className="entry">
              <button className="cta cornered" onClick={newWallet}><Corners c="#12000d" />NEW WALLET</button>
            </div>
            {wallets.length === 0 && <p className="note">none yet — create one to sign sealed bids</p>}
            {wallets.map((w) => (
              <div key={w.id} className={`wrow ${walletId === w.id ? 'on' : ''}`}>
                <button className="wsel" onClick={() => setWalletId(walletId === w.id ? null : w.id)}>
                  <span className="mono">{short(w.address)}</span>
                  <span className="wlbl">{w.label}</span>
                </button>
                <button className="wdel" onClick={() => dropWallet(w.id)}>x</button>
              </div>
            ))}
            <p className="note">
              The key lives in this browser and signs type 0x4A transactions — a stock EVM wallet cannot.
              For a social-login embedded wallet, drop Privy in here (needs a Privy App ID).
            </p>
          </div>

          <div className="rail-block">
            <div className="pane-label">ACCOUNT</div>
            {extAddr ? (
              <p className="note">
                Connected wallet <span className="mono">{short(extAddr)}</span> — signs ordinary
                transactions (open a lot, award). Sealed bids need a local signer, because a type 0x4A
                transaction cannot be signed by a stock EVM wallet.
              </p>
            ) : (
              <p className="note">
                Acting with {wallets.find((w) => w.id === walletId)?.label || 'a bundled demo key'}. Press CONNECT
                WALLET to use your own EVM wallet for the ordinary actions; sealed bids need the embedded
                wallet.
              </p>
            )}
          </div>

          <div className="rail-block">
            <div className="pane-label">ACTIVITY</div>
            {feed.length === 0 && <p className="note">idle</p>}
            {feed.map((f, i) => <div key={i} className="feed">{f}</div>)}
          </div>

          {role === 'buyer' && (
            <div className="rail-block">
              <div className="pane-label">OPEN A TENDER</div>
              <div className="entry">
                <label>SUBJECT</label>
                <input id="t-title" defaultValue="Supply of server hardware" />
                <label>PRICE LIMIT, sUSDC</label>
                <input id="t-limit" defaultValue="100" />
                <label>WINDOW, MINUTES</label>
                <input id="t-mins" defaultValue="10" />
                <button className="cta cornered" disabled={busy} onClick={openTender}><Corners c="#12000d" />PUBLISH</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <footer className="foot">
        <span>BLINDBID <i>v0.1</i></span>
        <span className="sep">·</span>
        <a href={`${EXPLORER}/address/${CONTRACTS.BlindBid}`} target="_blank" rel="noreferrer">[ CONTRACT {CONTRACTS.BlindBid.slice(0, 10)}… ]</a>
        <span className="sep">·</span>
        <a href={EXPLORER} target="_blank" rel="noreferrer">[ EXPLORER ]</a>
        <span className="sep">·</span>
        <a href="https://docs.seismic.systems" target="_blank" rel="noreferrer">[ SEISMIC DOCS ]</a>
        <span className="grow" />
        <span>SEISMIC TESTNET · CHAIN 5124</span>
      </footer>
    </div>
  );
}
