// Конфиг фронтенда BlindBid (Seismic testnet).
// Адреса — из scripts/deploy.mjs; после редеплоя обновить здесь.
export const RPC = 'https://testnet-3.seismictest.net/rpc';
export const CHAIN_ID = 5124;
export const EXPLORER = 'https://seismic-testnet.socialscan.io';

export const CONTRACTS = {
  BlindBid: '0xd9191d5f065a44778890de4e80c57fc2b1237ec4',
  SealStore: '0x427b3bc3a4fae1862ca380ffba35b349e7f91e85',
};

export const SUSDC = '0x790701048922e265105fd6a4467a2901c2201c43';
export const SUSDC_DECIMALS = 6;


// ABI выгружен из artifacts.json (scripts/build.mjs) — сокращён до нужных методов.
export const BlindBidAbi = [
  { type: 'function', name: 'tenderCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function', name: 'tender', inputs: [{ name: 'tenderId', type: 'uint256' }], outputs: [{
      type: 'tuple', components: [
        { name: 'buyer', type: 'address' }, { name: 'title', type: 'string' }, { name: 'memo', type: 'string' },
        { name: 'budget', type: 'uint256' }, { name: 'deadline', type: 'uint64' }, { name: 'bidCount', type: 'uint32' },
        { name: 'winner', type: 'address' }, { name: 'winningAmount', type: 'uint256' },
        { name: 'priceRevealed', type: 'bool' }, { name: 'sealedPrice', type: 'bool' }, { name: 'status', type: 'uint8' },
      ],
    }], stateMutability: 'view',
  },
  {
    type: 'function', name: 'createTender', inputs: [
      { name: 'title', type: 'string' }, { name: 'memo', type: 'string' }, { name: 'budget', type: 'uint256' },
      { name: 'deadline', type: 'uint64' }, { name: 'sealedPrice', type: 'bool' },
    ], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'nonpayable',
  },
  { type: 'function', name: 'submitBid', inputs: [{ name: 'tenderId', type: 'uint256' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'uint32' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'closeAndAward', inputs: [{ name: 'tenderId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'myBid', inputs: [{ name: 'tenderId', type: 'uint256' }, { name: 'idx', type: 'uint32' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'bidAmount', inputs: [{ name: 'tenderId', type: 'uint256' }, { name: 'idx', type: 'uint32' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'tenderBids', inputs: [{ name: 'tenderId', type: 'uint256' }], outputs: [{ type: 'address[]' }, { type: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'totalCommitted', inputs: [{ name: 'tenderId', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'winningAmount', inputs: [{ name: 'tenderId', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'bidOwner', inputs: [{ name: 'tenderId', type: 'uint256' }, { name: 'idx', type: 'uint32' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'bidSlot', inputs: [{ name: 'tenderId', type: 'uint256' }, { name: 'idx', type: 'uint32' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'event', name: 'TenderCreated', inputs: [
    { name: 'id', type: 'uint256', indexed: true }, { name: 'buyer', type: 'address', indexed: true },
    { name: 'budget', type: 'uint256', indexed: false }, { name: 'deadline', type: 'uint64', indexed: false },
    { name: 'sealedPrice', type: 'bool', indexed: false },
  ] },
  { type: 'event', name: 'BidSubmitted', inputs: [
    { name: 'tenderId', type: 'uint256', indexed: true }, { name: 'bidIndex', type: 'uint32', indexed: true },
    { name: 'bidder', type: 'address', indexed: true },
  ] },
  { type: 'event', name: 'Awarded', inputs: [
    { name: 'tenderId', type: 'uint256', indexed: true }, { name: 'winner', type: 'address', indexed: true },
    { name: 'revealedAmount', type: 'uint256', indexed: false },
  ] },
] as const;
