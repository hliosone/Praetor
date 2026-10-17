# Praetor

> Self-driving money. The regulator holds the brakes.

FinTechathon 2026 (Shenzhen, WeBank x Tsinghua PBCSF), International Track, Topic F "Agent Wallet". An AI agent manages a portfolio and pays bills from an ERC-4337 Safe7579 account on Base Sepolia, bounded by an on-chain Mandate hook, with a FISCO BCOS consortium (bank, regulator, operator) holding the authority.

Specification: `spec/` (start with `spec/README.md`). Build progress: `docs/PROGRESS.md`. Full README in English and Chinese: M17.

```bash
make setup   # commit-msg hook
pnpm install
pnpm keys    # fills missing keys into .env (mode 600)
make up      # local stack (Docker Compose, infra/compose.yml)
make test    # unit tests, guards, gitleaks
```

All rights reserved. See `NOTICE` and `THIRD_PARTY_LICENSES.md`.
