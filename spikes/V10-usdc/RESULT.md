# V10: Circle USDC on Base Sepolia, chain addresses, faucets, DEMO_SCALE

Run 2026-10-17 03:50 UTC against `https://sepolia.base.org` (read-only `cast call`), block 48220370, chainId 84532.

## USDC

| Check | Result |
|---|---|
| Address | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` has code (proxy, FiatTokenProxy layout) |
| `name()` / `symbol()` / `decimals()` / `version()` | `"USDC"` / `"USDC"` / `6` / `"2"` |
| `DOMAIN_SEPARATOR()` | `0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818`, equal to the EIP-712 hash of `{name:"USDC", version:"2", chainId:84532, verifyingContract: USDC}` (recomputed with `cast keccak`) |
| Implementation | `0xd74cc5d436923b8ba2c179b4bCA2841D8A52C5B5` (zeppelinos slot `0x7050c9e0...`; the EIP-1967 slot is empty; `implementation()` agrees). Blockscout: verified **`FiatTokenV2_2`**, solc 0.6.12 |
| Admin | `0xD48f3032f64e3127883FDa62BC2C47C698d6Baf7` |
| ERC-1271 path | **present.** Implementation bytecode contains both overloads: `permit(address,address,uint256,uint256,bytes)` `0x9fd5a6cf`, `transferWithAuthorization(...,bytes)` `0xcf092995`, `receiveWithAuthorization(...,bytes)` `0x88b7ab63`, `cancelAuthorization(address,bytes32,bytes)` `0xb7b72899`, plus the v,r,s overloads. Signatures go through the external library `SignatureChecker` at `0xbA3b60c21e28C41df4bABd90f228e1D368627DA6` (linked library, DELEGATECALL; its code contains the ERC-1271 selector `0x1626ba7e`): `isValidSignatureNow` calls `isValidSignature` on the owner when the owner is a contract. |

Consequence for I16 (spec 00 and 03): a Safe7579 account returning a valid ERC-1271 value would let anyone run `permit` or `transferWithAuthorization` on its USDC without the hook. Our validators must return `0xffffffff` and `NoOwner` must fail; the M2/M3 fork tests must call the **bytes-signature overloads** (`0x9fd5a6cf`, `0xcf092995`, `0x88b7ab63`), not only the v,r,s ones, which always use ecrecover and cannot be satisfied by a contract.

## Other contracts on Base Sepolia (code present)

| Contract | Address | Code |
|---|---|---|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | 16 KB |
| Safe7579 adapter | `0x7579EE8307284F293B1927136486880611F20002` | 20 KB, `accountId() = "rhinestone.safe7579.v1.0.0"` |
| Safe7579 launchpad | `0x7579011aB74c46090561ea277Ba79D510c6C00ff` | 11 KB |
| Rhinestone registry | `0x000000000069E2a187AEFFb852bF3cCdC95151B2` | 18 KB |
| Rhinestone attester (used for GS000 fix) | `0x000000333034E9f539ce08819E12c1b8Cb29084d` | 171 bytes (a contract, not an EOA) |
| RIP-7212 P-256 precompile | `0x0000000000000000000000000000000000000100` | no code (precompile): fresh software P-256 signature returns `0x...01`; a tampered hash returns empty `0x` (`spikes/V10-usdc/p256-input.mjs`) |

## Gas price (for funding amounts)

`eth_gasPrice` = 6,000,000 wei (0.006 gwei), base fee 5,000,000 wei. At that price 1M gas costs 0.000006 ETH; the whole contract suite (estimate 30M gas) about 0.0002 ETH. Base Sepolia gas has spiked above 1 gwei in the past, so funding keeps a 50x margin.

## Faucets

- **Circle USDC** (https://faucet.circle.com, checked live): "Developers can request 20 USDC on testnet every 2 hours, per address, and per blockchain." Base Sepolia is in the list. Circle's Developer Console faucet also gives 20 USDC per request, 10 requests per 24 h per developer account (search result, not re-checked).
- **Base Sepolia ETH**: Base's docs only link to a faucets page (not readable here). Usual options: Coinbase Developer Platform faucet, Alchemy, QuickNode, Superchain faucet; limits not verified in this spike. The amounts needed are tiny (see above), one claim per address is enough.

## DEMO_SCALE proposal

Persona Lin: 10,000 USD (5,300 USDC, 3,200 USD tXAU, 1,500 USD tXAG). Our metal tokens are minted by our desk, so only USDC is scarce.

- **Main live runs: `DEMO_SCALE=100`** (Lin holds 53 USDC + 32 USD tXAU + 15 USD tXAG; café 0.125, Café Lumen 3, rent 12, gold sale 6.50, caps and budgets divided by 100). One full live run needs about 53 USDC (account) + 30 USDC (desk reserve for metal sells) + 15 USDC (rent and payments) = **about 100 USDC**, i.e. 5 faucet requests on one address (10 h), or one request each on 5 of our own addresses sent to the treasury.
- **Judges' sandbox**: real USDC does not scale to one account per judge (20 USDC every 2 h per address). Proposed default: the sandbox deployment uses our own labelled test stablecoin **"pUSD"** (6 dp, mintable by the sandbox treasury), same code paths; the main live deployment keeps Circle USDC.

## Verdict

**PASS** (Circle USDC confirmed, FiatToken v2.2 with the ERC-1271 path, every external address has code, P-256 precompile live). `DEMO_SCALE=100` for live runs; sandbox on pUSD (needs confirmation).

## Traps (for QUESTIONS.md)

1. USDC on Base Sepolia is FiatToken v2.2 with the bytes-signature (ERC-1271) overloads of `permit`, `transferWithAuthorization`, `receiveWithAuthorization`. Default: the I16 fork tests call all three bytes overloads with agent key, passkey and empty signatures, and the hook classifies all of them as SELECTOR_NOT_ALLOWED.
2. Circle faucet gives 20 USDC per 2 h per address. Default: `DEMO_SCALE=100` for the main live runs (about 100 USDC to collect on LIVE_TREASURY before M16).
3. The sandbox cannot use real USDC per judge. Default: sandbox deployment on our own "pUSD" (labelled "test dollar"), main live deployment on Circle USDC.
4. The registry attester `0x000000333034...084d` is a contract. No action; recorded because Alex's notes call it "Rhinestone's attester" without saying.
