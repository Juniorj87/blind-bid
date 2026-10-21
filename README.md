# BlindBid — sealed bids on Seismic

A tender where **the bid amount never appears in public state and never appears in the transaction**.

The calldata is encrypted (transaction type `0x4A`), the price lands in a private slot (`CSTORE`), and the
winner is computed **inside the TEE** — only the winning slot leaves the enclave. Not just the amounts:
the *ranking* of the bids never existed publicly either.

Seismic testnet · chain **5124** · deployed and verified end to end · **25/25 checks passing**.

![BlindBid — public sheet](docs/shots/01-public-sheet.png)

---

## The three layers

| Layer | What an observer sees |
|---|---|
| **Transaction** | "someone called a function on `0xd919…7ec4`" — not which function, not the arguments (type `0x4A`) |
| **State** | `eth_getStorageAt` → `0x0000…0000` for every bid slot |
| **Comparison** | the winner only — the ordering was computed inside the enclave and never left it |

![Privacy path](docs/diagrams/privacy-path.svg)

---

## Live deployment

| Contract | Address |
|---|---|
| `BlindBid` (tender logic, plain Solidity 0.8.37) | [`0xd9191d5f065a44778890de4e80c57fc2b1237ec4`](https://seismic-testnet.socialscan.io/address/0xd9191d5f065a44778890de4e80c57fc2b1237ec4) |
| `SealStore` (private storage, Yul library) | [`0x427b3bc3a4fae1862ca380ffba35b349e7f91e85`](https://seismic-testnet.socialscan.io/address/0x427b3bc3a4fae1862ca380ffba35b349e7f91e85) |

RPC: `https://testnet-3.seismictest.net/rpc` · gas token: **sUSDC** (6 decimals, no native ETH).

### What is on chain right now

| Lot | Subject | Envelopes | State | Buyer |
|---|---|---|---|---|
| #01 | Supply of server hardware | 3 | **AWARDED** — winner bid 12.00 sUSDC of 50 / 12 / 90 | deployer |
| #02 | Confidential audit of a treasury | 4 | **ACCEPTING BIDS** — sealed price, the winning price is never published | deployer |
| #03 | Managed security monitoring | 2 | **AWARDED** — 45.00 sUSDC | demo buyer |
| #04 | Supply of network switches | 1 | **CANCELLED** (pilot run) | demo buyer |
| #05 | Supply of network switches | 2 | **AWARDED** — 63.00 sUSDC | demo buyer |

Lots #03–#05 are owned by the bundled demo buyer, so the **buyer sheet** opens for them in the front end.

---

## Screenshots

**Buyer sheet — signed read.** The raw slots on the right read as zeros for everyone; the buyer sees the
amounts because `msg.sender` is recovered from a signature.

![Buyer sheet](docs/shots/02-buyer-sheet.png)

**Supplier sheet — filing a sealed bid.** The price is sealed client-side and sent as a type `0x4A`
transaction.

![Supplier sheet](docs/shots/03-supplier-sheet.png)

![System map](docs/diagrams/system-map.svg)

---

## Try it in five minutes

You do not need our deployment — deploy your own in one command.

```bash
git clone https://github.com/Juniorj87/blind-bid.git
cd blind-bid
npm install

# 1. your key + a funded testnet account (see "Wallets and gas" below)
echo "MAIN_PK=0x..." > .env

# 2. deploy the two contracts and seed five demo lots
npm run seed

# 3. read-only self-test against your deployment (no gas needed)
npm test

# 4. the front end
npm run writer    # local signer  → http://127.0.0.1:4181
npm run web       # showcase      → http://localhost:5173
```

`npm run seed` deploys `SealStore` → `BlindBid`, opens the lots, files the sealed bids as real `0x4A`
transactions, awards them, and writes `deployments.json`, `web/src/config.ts` and
`web/src/demo-accounts.ts`.

### Scripts

| Command | What it does |
|---|---|
| `npm run build` | compiles the Solidity and the Yul library → `artifacts.json` |
| `npm run deploy` | deploys the two contracts only |
| `npm run seed` | deploy + demo data + funds the demo accounts |
| `npm test` | 25 read-only checks (network, contracts, privacy, award, aggregates) |
| `npm run test:scan` | additionally scans recent blocks and asserts the bid transactions are type `0x4A` |
| `npm run report` | regenerates `TEST-REPORT.md` |
| `npm run writer` | local signer for the front end (`127.0.0.1:4181`) |
| `npm run web` | the front end |
| `npm run demo` | end-to-end scenario in one process: tender → 3 bids → award → all three views |

---

## How the privacy works

```
supplier                    BlindBid contract                    observer
    │                              │                                  │
    │  submitBid(amount)           │                                  │
    ├──── tx type 0x4A ───────────►│ calldata encrypted client-side    │
    │                              │                                  │
    │                              │──► SealStore.store(slot, v)       │
    │                              │    CSTORE → slot flagged private,  │
    │                              │    raw storage reads as zero       │
    │                              │                                  │
    │                 closeAndAward│                                  │
    │                              │──► SealStore.minSlot(slots)       │
    │                              │    comparison inside the TEE:      │
    │                              │    only the slot leaves            │
    │                              │──► winner address                  │
```

1. **Transaction.** `shieldedWriteContract` produces type `0x4A`. The calldata is encrypted to the node's
   public key before it is signed, so the explorer shows an opaque blob.
2. **State.** `SealStore` writes with `CSTORE` (`0xB1`), which flags the slot private. A raw
   `eth_getStorageAt` returns zeros — visible in the screenshot above and in `TEST-REPORT.md`.
3. **Comparison.** The winner is found by comparing private values *inside* the enclave (`minSlot`), so
   even the order of the bids was never public. The buyer still gets what an auditor needs: every amount
   (signed read) and the **aggregate** (`totalCommitted`) — the sum, without any single bid.

### Why it is built this way

Seismic ships no Windows build of its compiler (`sforge`/`ssolc` are linux/macOS only) and the shielded
types (`suint256`, `sbool`) exist only in that compiler. So:

- **Private storage is a separate Yul library** (`contracts/SealStore.yul`) that injects `CLOAD`/`CSTORE`
  through `verbatim`. The tender logic stays plain, readable Solidity.
- **Reads are signed reads.** On Seismic, `eth_call` does not apply `from` — `msg.sender` is recovered
  from a signature. That is why the buyer sheet is a `signedReadContract`, not a normal read.
- **Gas is paid in sUSDC.** There is no native ETH, so value transfers are impossible and every
  transaction is a `transfer` of the gas token.

`SealStore` is called with an ordinary `call`/`staticcall`, **not** `delegatecall`: `CLOAD` inside a
delegatecall does not work in the `eth_call`/static context the node uses to simulate.

---

## Tests

```bash
npm test           # 25 checks, no gas
npm run report     # regenerates TEST-REPORT.md
```

`TEST-REPORT.md` is the generated artifact: addresses, the full self-test output, the on-chain state of
every lot, the **raw private-slot reads** (all zeros) and the **buyer-only signed-read table**.

The checks are not cosmetic — they assert the thesis:

```
  lot #0  "Supply of server hardware"  bids=3  status=1
  PASS  private slots read as zero for an outside observer  — 0x0000 0x0000 0x0000
  PASS  winner is set  — 0x1992842ECd4385506c3683B689D561B7D8a64c2a
  PASS  winning amount is published  — 12 sUSDC
  PASS  winner holds the lowest bid  — min=12
  PASS  aggregate matches the sum of bids  — 152 sUSDC
  PASS  winner appears in the bid list  — index 1
```

There are no Solidity unit tests: `sforge` does not build on Windows, so the suite is written as
end-to-end scenarios against a live deployment (`scripts/selftest.mjs`, `scripts/demo.mjs`).

---

## Wallets and gas

Everything below is **testnet only**. No mainnet asset, no value, no third-party funds.

| Role | Address | Key |
|---|---|---|
| Deployer — owner of lots #01, #02 | `0x424fF7f4A7CBB654E5168829C8535be3C0ef2e6c` | burner, kept outside the repo in `.env` as `MAIN_PK` |
| Demo buyer — owner of lots #03–#05 | `0xC692DeD9eEdf80436877f2A6B022ac9E3CB561E4` | **public** in `web/src/demo-accounts.ts` |
| Demo supplier | `0x1992842ECd4385506c3683B689D561B7D8a64c2a` | **public** in `web/src/demo-accounts.ts` |
| Demo supplier B | `0x06eb92C5D278176a22BAb02528dD1c3b40F79F4b` | **public** in `web/src/demo-accounts.ts` |

The three demo keys are published on purpose: they are burners that hold test sUSDC only, so anyone can
reproduce the demo without touching a real wallet. The deployer key is **not** in this repository — set
your own `MAIN_PK` and the scripts use yours.

**Where the gas came from.** The official faucet (<https://faucet.seismictest.net>) grants 10 sUSDC per
GitHub account per 24 h. The deployer account was topped up there on 2026-10-21 (~17:00 UTC). A sealed
bid is a type `0x4A` transaction and costs ≈ **0.07 sUSDC**; a plain transaction ≈ 0.003 sUSDC.

**The faucet is currently broken for everyone** (RFC 9207: GitHub added an `iss` parameter to the OAuth
callback and `next-auth@4.24.11` rejects it). The workaround is to replay the callback URL without
`iss` — see *Known limitations*.

---

## Why this, and not another auction

Sealed-bid auctions exist on other chains — Arcium, Inco, Zama, Midnight, Story — but only as ★0–5 hobby
repos about NFTs, freelance work, agriculture or data marketplaces, and **none of them on Seismic**
(0 of 37 third-party repos in the ecosystem). Three things are different here:

1. **The award is computed in the shielded domain.** Elsewhere the amounts are encrypted but the winner is
   computed off-chain or via commit–reveal. Here the comparison happens inside the TEE, so the ordering of
   the bids never existed publicly.
2. **It is a tender, not an auction.** Criteria, deadline, award notice and an aggregate for the
   regulator. Seismic's testnet was built with local governments, and municipal procurement is sealed by
   law.
3. **The price can stay sealed after the award** (`sealedPrice`, lot #02). In a normal auction the winning
   price is disclosed to everyone, otherwise it is not an auction; in compliance-grade procurement it
   does not have to be.

The point of the demo is not to farm transactions — it is to show that a *real* procurement workflow
runs end to end on Seismic privacy primitives, with the audit trail a regulator would ask for and without
exposing the commercial data of the bidders.

---

## The front end

One page, three sheets over the same lot:

- **public sheet** — envelope count, deadline, winner; amounts rendered as redactions; the raw private
  slots with the zeros the chain returns; live block counter and contract traffic.
- **buyer sheet** — signed read: every amount, the audit aggregate, and the award button.
- **supplier sheet** — file a sealed bid; the price is encrypted client-side.

`CONNECT WALLET` attaches an external EVM wallet for the ordinary actions. The app also keeps an
**embedded wallet** (the key is generated in the browser and stored in `localStorage`) because a stock
EVM wallet cannot sign type `0x4A` at all. For a social-login embedded wallet, drop Privy in here — it
needs a Privy App ID and a `@privy-io/react-auth` + wagmi + `seismic-react` setup, the same stack the
Seismic docs use.

### Why there is a local signer

The browser cannot produce a valid type `0x4A` payload — the node rejects it with *Error Decrypting in
Seismic EthApiExt* — while the identical call from Node signs and broadcasts correctly. The front end
therefore hands the key to `scripts/writer.mjs` on `127.0.0.1:4181`, which builds and signs the sealed
transaction and returns the hash. The key never leaves localhost. Ordinary actions (opening a lot,
awarding) are signed in the browser as normal transactions.

---

## Layout

```
blind-bid/
├── contracts/
│   ├── BlindBid.sol     # tender logic (plain Solidity 0.8.37)
│   └── SealStore.yul    # private storage: CLOAD/CSTORE, minSlot, sumSlots
├── scripts/
│   ├── build.mjs        # compile (solc + Yul) → artifacts.json
│   ├── deploy.mjs       # deploy SealStore → BlindBid → deployments.json
│   ├── seed-english.mjs # deploy + demo lots + fund the demo accounts
│   ├── seed-buyer-lot.mjs  # a lot owned by the demo buyer (opens the buyer sheet)
│   ├── selftest.mjs     # the 25 checks → npm test
│   ├── report.mjs       # regenerates TEST-REPORT.md
│   ├── writer.mjs       # local signer for the front end
│   ├── fund-demo.mjs    # top up the demo accounts with gas
│   ├── finish-lot.mjs   # finish a lot after an RPC rate-limit interruption
│   └── demo.mjs         # end-to-end scenario in one process
├── web/                 # the front end (Vite + React)
├── docs/
│   ├── shots/           # screenshots
│   └── diagrams/        # SVG diagrams
├── artifacts.json
├── deployments.json
└── TEST-REPORT.md
```

---

## Known limitations

- The front end is client-only (no SSR) and has no server component — it is a demo, not a product.
- The sealed bid has to go through the local signer (see above). This is a client/library issue with the
  node's decryption path in the browser, not a property of Seismic.
- The amount is passed to `SealStore` in an internal call — it is absent from the transaction, from state
  and from the explorer, and is only visible to someone tracing at `debug_traceTransaction` level.
- The winner and price are published at award (unless `sealedPrice` is set).
- The official faucet is broken for everyone (RFC 9207 `iss` parameter vs `next-auth@4.24.11`). Workaround:
  replay the OAuth callback URL without `iss`.
- Public testnet RPCs rate-limit aggressively (`429 Too Many Requests`); the scripts retry, but a demo
  that files many bids at once will feel it.
- No Solidity unit tests — `sforge` does not build on Windows.

---

Built by [@Juniorj87](https://github.com/Juniorj87) on the Seismic testnet. Test sUSDC only.
