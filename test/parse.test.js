const test = require('node:test');
const assert = require('node:assert');
const { parseSolanaTx } = require('../src/solana');
const { parseEvmTx, pad, TRANSFER, decodeString } = require('../src/evm');
const { extractWallets } = require('../src/resolve');
const { isSolanaAddress, isEvmAddress } = require('../src/util');
const { pickFromPairs } = require('../src/prices');

const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const RELAYER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const MEME = 'Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';

function tb(accountIndex, mint, owner, ui, decimals = 6) {
  return { accountIndex, mint, owner, uiTokenAmount: { uiAmountString: String(ui), decimals } };
}
function solTx({ keys, pre, post, preTok = [], postTok = [], fee = 5000, err = null }) {
  return {
    blockTime: 1760000000,
    meta: { err, fee, preBalances: pre, postBalances: post, preTokenBalances: preTok, postTokenBalances: postTok },
    transaction: { signatures: ['sig1'], message: { accountKeys: keys.map((pubkey) => ({ pubkey })) } },
  };
}

test('Solana: pump-style buy with SOL (wallet pays fee + opens token account)', () => {
  const rent = 2039280;
  const tx = solTx({
    keys: [WALLET, 'TokAcct111111111111111111111111111111111111', 'Pool1111111111111111111111111111111111111111'],
    pre: [5_000_000_000, 0, 0],
    post: [5_000_000_000 - 1_500_000_000 - 5000 - rent, rent, 0],
    postTok: [tb(1, MEME, WALLET, 123456.5)],
  });
  const s = parseSolanaTx(tx, WALLET);
  assert.equal(s.side, 'buy');
  assert.equal(s.token, MEME);
  assert.equal(s.tokenAmount, 123456.5);
  assert.ok(Math.abs(s.nativeAmount - 1.5) < 1e-9, `got ${s.nativeAmount}`);
  assert.equal(s.time, 1760000000000);
});

test('Solana: gasless buy via relayer, paid in USDC', () => {
  const tx = solTx({
    keys: [RELAYER, WALLET],
    pre: [1e9, 1e7],
    post: [1e9 - 10000, 1e7],
    preTok: [tb(2, USDC, WALLET, 500)],
    postTok: [tb(2, USDC, WALLET, 250), tb(3, MEME, WALLET, 9999)],
  });
  const s = parseSolanaTx(tx, WALLET);
  assert.equal(s.side, 'buy');
  assert.equal(s.stableUsd, 250);
  assert.equal(s.nativeAmount, 0);
});

test('Solana: sell token for SOL', () => {
  const tx = solTx({
    keys: [WALLET],
    pre: [1e9],
    post: [1e9 + 2e9 - 5000],
    preTok: [tb(1, MEME, WALLET, 1000)],
    postTok: [tb(1, MEME, WALLET, 0)],
  });
  const s = parseSolanaTx(tx, WALLET);
  assert.equal(s.side, 'sell');
  assert.ok(Math.abs(s.nativeAmount - 2) < 1e-9);
  assert.equal(s.tokenAmount, 1000);
});

test('Solana: buy through wrapped SOL counts as SOL spent', () => {
  const tx = solTx({
    keys: [RELAYER, WALLET],
    pre: [1e9, 0],
    post: [1e9, 0],
    preTok: [tb(1, WSOL, WALLET, 3, 9)],
    postTok: [tb(1, WSOL, WALLET, 1, 9), tb(2, MEME, WALLET, 50)],
  });
  const s = parseSolanaTx(tx, WALLET);
  assert.equal(s.side, 'buy');
  assert.equal(s.nativeAmount, 2);
});

test('Solana: token received for free (airdrop/transfer) is ignored', () => {
  const tx = solTx({ keys: [RELAYER, WALLET], pre: [1e9, 0], post: [1e9, 0], postTok: [tb(2, MEME, WALLET, 50)] });
  assert.equal(parseSolanaTx(tx, WALLET), null);
});

test('Solana: failed transaction is ignored', () => {
  const tx = solTx({ keys: [WALLET], pre: [1e9], post: [1e9 - 5000], postTok: [tb(1, MEME, WALLET, 5)], err: { x: 1 } });
  assert.equal(parseSolanaTx(tx, WALLET), null);
});

test('Solana: other wallets in the same tx do not count', () => {
  const OTHER = RELAYER;
  const tx = solTx({
    keys: [WALLET, OTHER],
    pre: [1e9, 1e9],
    post: [1e9 - 5000, 0.5e9],
    postTok: [tb(2, MEME, OTHER, 50)],
  });
  assert.equal(parseSolanaTx(tx, WALLET), null);
});

// ---------------- EVM ----------------
const EW = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const WETH = '0x4200000000000000000000000000000000000006';
const WITHDRAWAL = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';
const hex = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
const transfer = (token, from, to, amount) => ({ address: token, topics: [TRANSFER, pad(from), pad(to)], data: hex(amount) });

test('Base: buy a token with ETH', () => {
  const receipt = {
    status: '0x1',
    transactionHash: '0xabc',
    logs: [transfer(WETH, ROUTER, '0x9999999999999999999999999999999999999999', 5n * 10n ** 17n), transfer(TOKEN, ROUTER, EW, 1000n * 10n ** 18n)],
  };
  const tx = { from: EW, value: '0x' + (5n * 10n ** 17n).toString(16) };
  const s = parseEvmTx('base', receipt, tx, EW.toUpperCase().replace('0X', '0x'), new Map([[TOKEN, 18]]));
  assert.equal(s.side, 'buy');
  assert.equal(s.token, TOKEN);
  assert.equal(s.tokenAmount, 1000);
  assert.equal(s.nativeAmount, 0.5);
});

test('Base: sell a token for ETH (unwrapped by the router)', () => {
  const receipt = {
    status: '0x1',
    transactionHash: '0xdef',
    logs: [
      transfer(TOKEN, EW, ROUTER, 1000n * 10n ** 18n),
      { address: WETH, topics: [WITHDRAWAL, pad(ROUTER)], data: hex(3n * 10n ** 17n) },
    ],
  };
  const s = parseEvmTx('base', receipt, { from: EW, value: '0x0' }, EW, new Map([[TOKEN, 18]]));
  assert.equal(s.side, 'sell');
  assert.equal(s.nativeAmount, 0.3);
});

test('BNB: buy with USDT (18 decimals)', () => {
  const USDT = '0x55d398326f99059ff775485246999027b3197955';
  const receipt = {
    status: '0x1',
    transactionHash: '0x1',
    logs: [transfer(USDT, EW, ROUTER, 200n * 10n ** 18n), transfer(TOKEN, ROUTER, EW, 5n * 10n ** 9n)],
  };
  const s = parseEvmTx('bnb', receipt, { from: EW, value: '0x0' }, EW, new Map([[USDT, 18], [TOKEN, 9]]));
  assert.equal(s.side, 'buy');
  assert.equal(s.stableUsd, 200);
  assert.equal(s.tokenAmount, 5);
});

test('EVM: plain token transfer in is not a buy; reverted tx ignored', () => {
  const receipt = { status: '0x1', transactionHash: '0x2', logs: [transfer(TOKEN, ROUTER, EW, 10n ** 18n)] };
  assert.equal(parseEvmTx('base', receipt, { from: ROUTER, value: '0x0' }, EW, new Map()), null);
  assert.equal(parseEvmTx('base', { ...receipt, status: '0x0' }, { from: EW, value: '0x1' }, EW, new Map()), null);
});

test('EVM: token name decoding', () => {
  const abi = '0x' + hex(32).slice(2) + hex(4).slice(2) + Buffer.from('PEPE').toString('hex').padEnd(64, '0');
  assert.equal(decodeString(abi), 'PEPE');
});

// ---------------- Resolver ----------------
test('Resolver: reads the getfomoapi.fun response shape', () => {
  const r = extractWallets({
    responseObject: { id: '254245a7-575a-51be-9bc3-090a924789eb', solana: '6xmMW5JPSEfeRuNdkxixHWsm4Sf57SdXybA3BdwZzrM1', evm: '0x4bc1782fafb967834e0e75947ba15113e48fc70e' },
  });
  assert.equal(r.sol, '6xmMW5JPSEfeRuNdkxixHWsm4Sf57SdXybA3BdwZzrM1');
  assert.equal(r.evm, '0x4bc1782fafb967834e0e75947ba15113e48fc70e');
});

test('Resolver: reads a list-of-wallets shape and skips token addresses', () => {
  const r = extractWallets({
    handle: 'unipcs',
    wallets: [
      { chain: 'solana', address: WALLET },
      { chain: 'evm', address: '0x4BC1782FAFB967834E0E75947BA15113E48FC70E' },
    ],
    topHoldings: [{ mint: MEME }],
  });
  assert.equal(r.sol, WALLET);
  assert.equal(r.evm, '0x4bc1782fafb967834e0e75947ba15113e48fc70e');
});

test('Resolver: nothing found', () => {
  const r = extractWallets({ error: 'user not found' });
  assert.equal(r.sol, null);
  assert.equal(r.evm, null);
});

test('Address checks', () => {
  assert.ok(isSolanaAddress(WALLET));
  assert.ok(!isSolanaAddress('hello'));
  assert.ok(!isSolanaAddress('0x4bc1782fafb967834e0e75947ba15113e48fc70e'));
  assert.ok(isEvmAddress('0x4bc1782fafb967834e0e75947ba15113e48fc70e'));
  assert.ok(!isEvmAddress('0x123'));
});

test('Dexscreener: picks the most liquid pair and handles the token being the quote side', () => {
  const pairs = [
    { baseToken: { address: MEME, name: 'Bonk', symbol: 'BONK' }, priceUsd: '0.00002', liquidity: { usd: 1000 } },
    { baseToken: { address: MEME, name: 'Bonk', symbol: 'BONK' }, priceUsd: '0.00003', liquidity: { usd: 90000 }, url: 'u' },
  ];
  const r = pickFromPairs('solana', MEME, pairs);
  assert.equal(r.symbol, 'BONK');
  assert.equal(r.priceUsd, 0.00003);
  const q = pickFromPairs('solana', WSOL, [
    { baseToken: { address: MEME, symbol: 'X' }, quoteToken: { address: WSOL, name: 'Wrapped SOL', symbol: 'SOL' }, priceUsd: '0.5', priceNative: '0.0025', liquidity: { usd: 5 } },
  ]);
  assert.equal(q.priceUsd, 200);
});
