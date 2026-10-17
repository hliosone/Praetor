# Decisions

Decisions taken during the build that the spec leaves open, or where two spec files disagree. Each entry: date, decision, why, invariant or flow concerned. Spec decisions themselves live in `spec/00-decisions.md` and are not repeated here.

| # | Date | Decision | Why | Concerns |
|---|---|---|---|---|
| D1 | 2026-10-17 | Key sets in one `.env` use prefixes `LOCAL_`, `LIVE_`, `SANDBOX_` on every wallet key of spec 11 (e.g. `LIVE_BUNDLER_KEY`). Services read the unprefixed name first, then the prefix of the active set. Shared secrets stay unprefixed. | Spec 00 requires separate member keys per environment while spec 11 lists unprefixed names; both hold with prefixes. Pending human confirmation (QUESTIONS.md). | I3, domain separation |
| D2 | 2026-10-17 | `DEPLOYER_KEY` deploys on both Base and FISCO; the bank FISCO account is the FISCO governance admin (`build_chain.sh -a`). | Spec 04 names the bank admin for `-a` and "the deployer account" for the deploy ACL, without a separate FISCO deployer variable. | FISCO deploy ACL |
