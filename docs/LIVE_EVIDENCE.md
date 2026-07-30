# Live Coston2 evidence

Observed 30 July 2026 on Coston2 (`chainId` 114). These are real testnet
transactions, not local mocks.

## Run 1 — safe calibration fallback

- Personal Account nonce: `0`
- XRPL payment: `1,100,000` drops
- XRPL transaction:
  [`EE6FE5…14DFF5`](https://testnet.xrpl.org/transactions/EE6FE5247F6C4F7D5981C436BF3A363266C9BB3E7BF0143A6C7CB8419C14DFF5)
- FDC voting round:
  [`1410449`](https://coston2-systems-explorer.flare.network/voting-round/1410449?tab=fdc)
- Coston2 transaction:
  [`62BE9E…54B9B`](https://coston2-explorer.flare.network/tx/0x62be9e984b27d29a8d469374301b90eef60b8dec7a119e729d352e892f554b9b)
- Result: `SETTLED_FALLBACK`, failure code `5`, returned amount
  `1,000,000` UBA.

The explorer internal-call trace showed that the original 500k entry floor
allowed only about 224k gas into the adapter. The vault deposit ran out of gas.
The Router caught the isolated revert, returned the exact FXRP to the Personal
Account and let the enclosing Smart Account operation finish normally.

## Run 2 — protected deposit success

- Personal Account nonce: `1`
- XRPL payment: `1,100,000` drops
- XRPL transaction:
  [`9E3217…C70DB5`](https://testnet.xrpl.org/transactions/9E32179C62624D57272D02A5877EBBA08D3CB62F303826A37F1AC406A3C70DB5)
- FDC voting round:
  [`1410454`](https://coston2-systems-explorer.flare.network/voting-round/1410454?tab=fdc)
- Coston2 transaction:
  [`3FF86C…86BE40`](https://coston2-explorer.flare.network/tx/0x3ff86c9102e5aff6d45c02efcfeec2df5bfa9139065dcde7911d7ea84986be40)
- Result: `SETTLED_SUCCESS`, input `1,000,000` UBA, output
  `1,000,000` vault shares.

This run used the revised 900k entry floor and 500k adapter cap.

## Run 3 — deliberate protected fallback

- XRPL transaction:
  [`3FACEA…340FE1`](https://testnet.xrpl.org/transactions/3FACEACAC1A754E52955381CE7ABF57064A624F8A80B55C4DF43244C4D340FE1)
- FDC voting round:
  [`1410461`](https://coston2-systems-explorer.flare.network/voting-round/1410461?tab=fdc)
- Coston2 transaction:
  [`CEC72E…CC3889`](https://coston2-explorer.flare.network/tx/0xcec72e773b02b7139b7155355c58f2b5dd4c83909e4abb33301c7db8cdcc3889)
- Result: `SETTLED_FALLBACK`, failure code `5`, returned amount
  `1,000,000` UBA.

The FailureVault was deliberately put in `REVERT_ALWAYS` mode before this run
and restored to `NONE` afterward.

## Bare failure and official recovery

The Router-less UserOp approved the vault and called `deposit` directly while
the target was in `REVERT_ALWAYS` mode.

- Original XRPL transaction:
  [`D5FAC7…A77A11`](https://testnet.xrpl.org/transactions/D5FAC7B9F288C7F7781D4F7A281C56DBCBB07F21ED622A89B6102BD72AA77A11)
- Original FDC round:
  [`1410470`](https://coston2-systems-explorer.flare.network/voting-round/1410470?tab=fdc)
- Reverted Coston2 finalization:
  [`DB6767…13C37`](https://coston2-explorer.flare.network/tx/0xdb6767f3ea3c849a4ab07399ec1b9e1bcca592c67a9a3dd560ac053766913c37)

The original XRPL payment remained unused on Flare and nonce remained `3`.
Recovery required:

1. A second 1.1 XRP Testnet payment carrying `0xE0`.
2. Recovery FDC round `1410472`.
3. [`IgnoreMemoSet` finalization](https://coston2-explorer.flare.network/tx/0xeadde4a7b5d03005e56beb65bd5a62af3a2763d7aa1e2149b8317ae676f01751).
4. [Original proof retry](https://coston2-explorer.flare.network/tx/0x078b8e189dca4907e67d71efc02c004e54dee643bcab42c5cdfd7924021c4290).

The recovery payment credited 1,000,000 UBA with zero signed executor fee.
Because the original memo was ignored, its retry used the live default
100,000 UBA executor fee and credited 900,000 UBA to the Personal Account.
The observed 1,900,000 UBA increase exactly matches both events.

## Final cross-check

| State | UBA |
|---|---:|
| Personal Account FXRP | 3,900,000 |
| Personal Account vault shares | 1,000,000 |
| FailureVault FXRP backing | 1,000,000 |
| Vault share supply | 1,000,000 |
| Router residual FXRP | 0 |
| Adapter residual FXRP | 0 |
| PA → Router allowance | 0 |
| Router → adapter allowance | 0 |
| Adapter → vault allowance | 0 |

The machine-readable records are
[`evidence/live-runs.json`](../evidence/live-runs.json) and
[`evidence/settlement-balances.json`](../evidence/settlement-balances.json).
The bare comparison and recovery are recorded in
[`evidence/bare-recovery.json`](../evidence/bare-recovery.json).
They intentionally exclude private keys, signed XRPL transaction blobs and raw
user-operation payloads.
