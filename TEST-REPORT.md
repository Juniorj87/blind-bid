# Test report

Generated 2026-10-21T18:24:13.812Z · chain 5124 (Seismic testnet) · block 65150423

## Deployment

| Contract | Address |
| --- | --- |
| BlindBid | `0xd9191d5f065a44778890de4e80c57fc2b1237ec4` |
| SealStore (private storage) | `0x427b3bc3a4fae1862ca380ffba35b349e7f91e85` |

RPC: `https://testnet-3.seismictest.net/rpc` · explorer: https://seismic-testnet.socialscan.io

## Self-test

```
BLINDBID · self-test
rpc https://testnet-3.seismictest.net/rpc · contract 0xd9191d5f065a44778890de4e80c57fc2b1237ec4

network
  PASS  chainId is 5124  — got 5124
  PASS  chain is producing blocks  — 65150337 -> 65150337

contracts
  PASS  BlindBid has code  — 0xd9191d5f065a44778890de4e80c57fc2b1237ec4 (7380 bytes)
  PASS  SealStore has code  — 0x427b3bc3a4fae1862ca380ffba35b349e7f91e85 (222 bytes)

tenders
  PASS  at least one tender exists  — 5 tenders

  lot #0  "Supply of server hardware"  bids=3  status=1
  PASS  private slots read as zero for an outside observer  — 0x0000 0x0000 0x0000
  PASS  winner is set  — 0x1992842ECd4385506c3683B689D561B7D8a64c2a
  PASS  winning amount is published  — 12 sUSDC
  PASS  winner holds the lowest bid  — min=12
  PASS  aggregate matches the sum of bids  — 152 sUSDC
  PASS  winner appears in the bid list  — index 1

  lot #1  "Confidential audit of a treasury"  bids=4  status=0
  PASS  private slots read as zero for an outside observer  — 0x0000 0x0000 0x0000 0x0000

  lot #2  "Managed security monitoring"  bids=2  status=1
  PASS  private slots read as zero for an outside observer  — 0x0000 0x0000
  PASS  winner is set  — 0x1992842ECd4385506c3683B689D561B7D8a64c2a
  PASS  winning amount is published  — 45 sUSDC
  PASS  winner holds the lowest bid  — min=45
  PASS  aggregate matches the sum of bids  — 105 sUSDC
  PASS  winner appears in the bid list  — index 0

  lot #3  "Supply of network switches"  bids=1  status=2
  PASS  private slots read as zero for an outside observer  — 0x0000

  lot #4  "Supply of network switches"  bids=2  status=1
  PASS  private slots read as zero for an outside observer  — 0x0000 0x0000
  PASS  winner is set  — 0x06eb92C5D278176a22BAb02528dD1c3b40F79F4b
  PASS  winning amount is published  — 63 sUSDC
  PASS  winner holds the lowest bid  — min=63
  PASS  aggregate matches the sum of bids  — 141 sUSDC
  PASS  winner appears in the bid list  — index 1

25 passed, 0 failed
```

## On-chain state

### Lot #0

- subject: Supply of server hardware
- price limit: 100 sUSDC
- envelopes filed: 3
- status: AWARDED
- winner: `0x1992842ECd4385506c3683B689D561B7D8a64c2a`
- winning price: 12 sUSDC

**Private slots, read raw from the chain** (what any observer sees):

| Slot | Raw value |
| --- | --- |
| `0xad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5` | `0x0000000000000000000000000000000000000000000000000000000000000000` |
| `0xa6eef7e35abe7026729641147f7915573c7e97b47efa546f5f6e3230263bcb49` | `0x0000000000000000000000000000000000000000000000000000000000000000` |
| `0xac33ff75c19e70fe83507db0d683fd3465c996598dc972688b7ace676c89077b` | `0x0000000000000000000000000000000000000000000000000000000000000000` |

**Buyer view** (signed read, decrypted for the buyer only):

| Bidder | Amount |
| --- | --- |
| `0xC692DeD9eEdf80436877f2A6B022ac9E3CB561E4` | 50 sUSDC |
| `0x1992842ECd4385506c3683B689D561B7D8a64c2a` | 12 sUSDC |
| `0x06eb92C5D278176a22BAb02528dD1c3b40F79F4b` | 90 sUSDC |

### Lot #1

- subject: Confidential audit of a treasury
- price limit: 250 sUSDC
- envelopes filed: 4
- status: ACCEPTING BIDS


**Private slots, read raw from the chain** (what any observer sees):

| Slot | Raw value |
| --- | --- |
| `0xada5013122d395ba3c54772283fb069b10426056ef8ca54750cb9bb552a59e7d` | `0x0000000000000000000000000000000000000000000000000000000000000000` |
| `0xcc69885fda6bcc1a4ace058b4a62bf5e179ea78fd58a1ccd71c22cc9b688792f` | `0x0000000000000000000000000000000000000000000000000000000000000000` |
| `0xe90b7bceb6e7df5418fb78d8ee546e97c83a08bbccc01a0644d599ccd2a7c2e0` | `0x0000000000000000000000000000000000000000000000000000000000000000` |
| `0xa15bc60c955c405d20d9149c709e2460f1c2d9a497496a7f46004d1772c3054c` | `0x0000000000000000000000000000000000000000000000000000000000000000` |


### Lot #2

- subject: Managed security monitoring
- price limit: 200 sUSDC
- envelopes filed: 2
- status: AWARDED
- winner: `0x1992842ECd4385506c3683B689D561B7D8a64c2a`
- winning price: 45 sUSDC

**Private slots, read raw from the chain** (what any observer sees):

| Slot | Raw value |
| --- | --- |
| `0xabbb5caa7dda850e60932de0934eb1f9d0f59695050f761dc64e443e5030a569` | `0x0000000000000000000000000000000000000000000000000000000000000000` |
| `0xd9d16d34ffb15ba3a3d852f0d403e2ce1d691fb54de27ac87cd2f993f3ec330f` | `0x0000000000000000000000000000000000000000000000000000000000000000` |


### Lot #3

- subject: Supply of network switches
- price limit: 200 sUSDC
- envelopes filed: 1
- status: CANCELLED


**Private slots, read raw from the chain** (what any observer sees):

| Slot | Raw value |
| --- | --- |
| `0x101e368776582e57ab3d116ffe2517c0a585cd5b23174b01e275c2d8329c3d83` | `0x0000000000000000000000000000000000000000000000000000000000000000` |


### Lot #4

- subject: Supply of network switches
- price limit: 200 sUSDC
- envelopes filed: 2
- status: AWARDED
- winner: `0x06eb92C5D278176a22BAb02528dD1c3b40F79F4b`
- winning price: 63 sUSDC

**Private slots, read raw from the chain** (what any observer sees):

| Slot | Raw value |
| --- | --- |
| `0x52d75039926638d3c558b2bdefb945d5be8dae29dedd1c313212a4d472d9fde5` | `0x0000000000000000000000000000000000000000000000000000000000000000` |
| `0xedc95719e9a3b28dd8e80877cb5880a9be7de1a13fc8b05e7999683b6b567643` | `0x0000000000000000000000000000000000000000000000000000000000000000` |



## What the tests prove

1. The bid amounts never appear in public state — the slots that hold them read as zero.
2. A bid never exposes its arguments — it is a type `0x4A` transaction with encrypted calldata.
3. The winner is decided inside the TEE, so the ranking of the bids was never public either.
4. The buyer can still verify everything, and can prove an aggregate (sum of bids) without
   revealing any single bid.
