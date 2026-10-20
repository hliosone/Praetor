# Submission checklist

FinTechathon 2026, International Track, Topic F "Agent Wallet". **Deadline: 20 October 2026, 16:00 UTC** (18:00 on 20 October in Switzerland, CEST; 00:00 on 21 October, Beijing time). Stan submits before 10:00 CEST on 20 October (08:00 UTC). English is the official language; Chinese is a plus. Repository: https://github.com/hliosone/Praetor (**private**: see [TODO: GitHub access for judges] below).

Status as of 2026-10-20, after the server and Phala deployment (D106; [EVIDENCE-SERVER.md](../EVIDENCE-SERVER.md)). Items marked **[TODO: ...]** need a person.

## 1. The six deliverables

| # | Deliverable (the competition's wording) | What we submit | Done | Remaining |
|---|---|---|---|---|
| 1 | Technical documentation: architecture, core algorithms, security design | [ARCHITECTURE.md](../ARCHITECTURE.md) (中文: [zh-CN/ARCHITECTURE.md](../zh-CN/ARCHITECTURE.md)); PDF `docs/submission/ARCHITECTURE.pdf` (with its six mermaid diagrams rendered); the security pack [security/README.md](../security/README.md); the build specification [spec/README.md](../../spec/README.md) | Yes; the deployment and the TEE status updated on 2026-10-20 (D106), PDF rebuilt | Rebuild the PDF after any later change (`bash scripts/submission/build-pdfs.sh`) |
| 2 | A deck for a talk of at most 10 minutes | `docs/Praetor Pitch.pdf` (the lead's); its brief [pitch/deck-brief.md](../pitch/deck-brief.md) (13 slides, 8:45); the spoken text [pitch/speaker-notes.md](../pitch/speaker-notes.md); the diagrams in `docs/pitch/diagrams/dark/` | Brief, diagrams and speaker notes; slide 9 shows the server's WeChat run | Slide 13: DEMO_URL, EVIDENCE_URL and EMAIL as in section 2, [TODO: VIDEO_URL], with working QR codes; export PPTX and PDF; one timed rehearsal at 8:45 |
| 3 | A demo video of at most 5 minutes (optional) | [pitch/video-script.md](../pitch/video-script.md) (4:45, 580 words, 11 shots, setup within about 10 USDC on live); subtitles [pitch/video-subtitles.en.srt](../pitch/video-subtitles.en.srt) and [pitch/video-subtitles.zh-CN.srt](../pitch/video-subtitles.zh-CN.srt) | Script and subtitles; its server checks filled on 2026-10-20 | Record on the server (the script's "Before recording"), fill its `[TX-...]` placeholders, re-time the subtitles, upload: [TODO: VIDEO_URL] |
| 4 | Source code with README, GitHub link, deployment instructions and test cases | The repository; [README.md](../../README.md) and [README.zh-CN.md](../../README.zh-CN.md) (PDF `docs/submission/README.pdf`); deployment [DEPLOY.md](../DEPLOY.md) (中文: [zh-CN/DEPLOY.md](../zh-CN/DEPLOY.md)); tests: `make test` (guards, gitleaks, type-check, every unit test, Foundry), `make test-int`, `make e2e`, `make test-contracts-full`, `make test-fork`, `make redteam`, in `contracts/base/test`, `contracts/fisco/test`, `test/` (integration, e2e, red team, recovery) and `apps/web/e2e`; [LICENSE](../../LICENSE), [NOTICE](../../NOTICE), [THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md), [PREEXISTING.md](../PREEXISTING.md) | Yes | [TODO: GitHub access for judges]; a final `make test` on the submitted commit; a `submission` tag |
| 5 | Security self-assessment: permission tiers and known risks | [security/SELF_ASSESSMENT.md](../security/SELF_ASSESSMENT.md) (中文: [zh-CN/SELF_ASSESSMENT.md](../zh-CN/SELF_ASSESSMENT.md)); PDF `docs/submission/SELF_ASSESSMENT.pdf`; tiers in [section 2](../security/SELF_ASSESSMENT.md#2-permission-tiers), known risks in [section 5](../security/SELF_ASSESSMENT.md#5-known-risks); red team [security/redteam.md](../security/redteam.md); Slither [security/slither.md](../security/slither.md); dependencies [security/deps.md](../security/deps.md); TEE checklist [security/tee-checklist.md](../security/tee-checklist.md) | Yes; section 11 (TEE checklist results on Phala) filled on 2026-10-20, PDF rebuilt | Section 10 (pentest) not done; TEE items 1 (DEBUG bit left to Phala's verifier) and 6 (TLS ends at Phala's gateway) stay open; check that the I19 row of section 3 (the scan of Base data) is current |
| 6 | Execution evidence: real on-chain transaction hashes | [EVIDENCE-SERVER.md](../EVIDENCE-SERVER.md), written by hand on 2026-10-20 from Base Sepolia reads: the public server, its two Phala CVMs (app ids, compose hashes), the attester's activation and the WeChat run (KYA, mandate, WeChat link, refused UNKNOWN_PAYEE, SOTER approval, executed once), 8 transactions linked to BaseScan. [EVIDENCE.md](../EVIDENCE.md), generated from the chains by `scripts/evidence/collect.ts`: the run of 2026-10-18 on the M16 deployment, 10 flows, 21 BaseScan links, executed and refused, with the FISCO calls of each flow. PDF `docs/submission/EVIDENCE.pdf`: both, the server's run first | Yes | EVIDENCE_URL as in section 2. EVIDENCE.md is only regenerated, never edited further: a regeneration by `collect.ts` drops its three hand edits (the header's deployment note, the F5b title, the pointer to EVIDENCE-SERVER.md) |

The key transactions, all on Base Sepolia, from the 2026-10-18 evidence run (M16 deployment, MandateHook [`0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`](https://sepolia.basescan.org/address/0x839E104c8C2df983213a89CAcB58440Da4AdC2A9)); each was checked on 2026-10-19 with `eth_getTransactionReceipt` (status 1, mined):

| What it shows | Transaction | Deck slide |
|---|---|---|
| The agent pays a known payee alone (T1), Decision OK | [`0xa695c52e...f5f7b6be`](https://sepolia.basescan.org/tx/0xa695c52ed74d76ed8cdd43e4dca7dd1f1dcee466c5d1707eadc867f3f5f7b6be) | 6 |
| Rent by standing order through the payout rail (Alipay+ mock) | [`0xbf4f43b2...b6db4daf`](https://sepolia.basescan.org/tx/0xbf4f43b2ad6f2c277874f2a03d77ea5b295a1f9fddf1666bde848f0db6db4daf) | 6 |
| Injection: the model refused; the same payment signed with the agent key, Refused SANCTIONED | [`0x5a38adfe...e63bb9af`](https://sepolia.basescan.org/tx/0x5a38adfe8f4629c9cec40984f194ac5112c8d16ceda20941fc660d19e63bb9af) | 8 |
| New payee, Refused UNKNOWN_PAYEE | [`0x05226d47...4d0aacb0`](https://sepolia.basescan.org/tx/0x05226d47cb5f82514edcaaa803ef3c343bd8bbca712c979a14b0d2d64d0aacb0) | 9 until 2026-10-20 |
| The owner's approval registered (passkey) | [`0xc97fad10...3bb8cf97`](https://sepolia.basescan.org/tx/0xc97fad101c59278a824435782c745f862558c3aed1d45f5e0fe383763bb8cf97) | 9 until 2026-10-20 |
| The approved payment, executed once | [`0xf93ddb77...4398261b`](https://sepolia.basescan.org/tx/0xf93ddb77bd037fc5f6960b671cacc36bb59cd3f724a2c6144a3772934398261b) | 9 until 2026-10-20 |
| The regulator's freeze applied on Base (through WeCross) | [`0x188675bb...f5044778`](https://sepolia.basescan.org/tx/0x188675bb77d845fbf104eda99244875d087e94feda4bbd43c0fb3847f5044778) | 11 |
| An agent payment while frozen, Refused FROZEN | [`0x66d57e47...7c4ac187`](https://sepolia.basescan.org/tx/0x66d57e47c2e8b5c6e489c6b20385e34fca227f7248fa5dd35957c89f7c4ac187) | 11 |
| The audit head anchored on Base by two members | [`0x1f3ab980...8ca0fd5a`](https://sepolia.basescan.org/tx/0x1f3ab9809cebfeaa272d96e20be744f85bde657d364e5a2e4e5dfdfc8ca0fd5a) | 12 |
| The bank's KYA for the agent | [`0x8eeb18c1...3e6a2699`](https://sepolia.basescan.org/tx/0x8eeb18c15b544caff60b785626f6665dac1a0a1386e32d7255dfd09c3e6a2699) | 10 |

Slide 9 now shows the public server's WeChat run of 2026-10-20 instead (D101 deployment, MandateHook [`0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f`](https://sepolia.basescan.org/address/0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f)); each was checked on 2026-10-20 with `eth_getTransactionReceipt` (status 1):

| What it shows | Transaction | Deck slide |
|---|---|---|
| A payment to a new payee, Refused UNKNOWN_PAYEE | [`0x2ef41395...83a945ab`](https://sepolia.basescan.org/tx/0x2ef4139547686147528a899d01e09e974c93184f849e0378809b786683a945ab) | 9 |
| The approval registered with SOTER (Face ID in WeChat, checked by the attester in its Phala CVM) | [`0x9a6633db...f5b3ee18`](https://sepolia.basescan.org/tx/0x9a6633dbb93fff0d6694b737a503aa8fbdbf2e26e9305a1e48187ecef5b3ee18) | 9 |
| The approved payment, executed once | [`0x0a900425...689b1ab2`](https://sepolia.basescan.org/tx/0x0a90042508153fe9e283fa59b3186f507ce022706416b10245cbe3bf689b1ab2) | 9 |
| The bank activates the attester (measurement: the soter-attester's compose hash) | [`0x58cafa3e...4b9f3c24`](https://sepolia.basescan.org/tx/0x58cafa3eeb77dd5c6cccc2c5d5586e92b2fe4be3837dda5d7931c3f24b9f3c24) | |

FISCO transactions are listed in EVIDENCE.md without links: the consortium chain is local and has no public explorer (WeBASE was cut, D4).

## 2. Open items

- [TODO: GitHub access for judges] The repository is private, and every repository link in the PDFs points at `github.com/hliosone/Praetor/blob/main/...`, so those links answer 404 until the judges have access. Options: add the judges' GitHub accounts as read-only collaborators (ask the organisers for them), make the repository public at submission (the LICENSE already reads "Source made available for evaluation"; a team decision), or attach a `git archive` of the submitted commit as well.
- DEMO_URL (done 2026-10-20): https://app.praetorwallet.com (D106), for the deck, the video and the form. Visitors onboard at `/start`; the console (staff devices only, D99), WeChat (mini program testers only) and the one-click sandbox (local fork only) are not open to them there, and demo funds are small, on request from the team (README).
- [TODO: VIDEO_URL] After recording and uploading (unlisted).
- EVIDENCE_URL (done 2026-10-20): https://github.com/hliosone/Praetor/blob/main/docs/EVIDENCE-SERVER.md (the deck's slide 13 QR). It answers 404 while the repository is private (first item): until the judges have access, `docs/submission/EVIDENCE.pdf` in the submission holds the same page and the M16 run.
- EMAIL (done 2026-10-20): alex.huou@gmail.com and stanstelcher@gmail.com, on the deck's last slide.
- TEE wording (done 2026-10-20): agent-signer and soter-attester run in Phala Cloud CVMs (Intel TDX) on the server, and the README, ARCHITECTURE and SELF_ASSESSMENT (EN and 中文) say so, with the simulator only in local and fork runs; the architecture diagram's TEE box ("dstack simulator locally") still holds. The TEE checklist results are in SELF_ASSESSMENT section 11.
- Deployment addresses (fixed on 2026-10-19): the README and ARCHITECTURE (EN and 中文) name both deployments, the M16 MandateHook `0x839E...C2A9` (`base-sepolia-m16.json`) for the evidence run and the server's redeployment of 2026-10-19 (`0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f`, `infra/deployments/base-sepolia.json`, D101). EVIDENCE.md keeps M16 for its run and now says so in its header.
- PDFs (done 2026-10-20): rebuilt with `bash scripts/submission/build-pdfs.sh`; rebuild after any later change to their sources (section 4, "Versions").

## 3. Wording to fix before submission (found while preparing these files)

These pages contradicted the facts the deck and the video use. None of these points is a code problem. Items 1 to 8 were fixed on 2026-10-19 (docs only); item 9 is the deck, which only its owner can rebuild:

1. Fixed: `spec/12-submission.md`, storyboard step 5: "40 attacks, 0 executed" (now 100 attack runs, with a dated note). The red team ran 100 attack runs (88 distinct: 85 scripted and 3 on shared state, plus 12 live replays with the real model), 0 executed, on the local fork.
2. Fixed (README, README.zh-CN, both self-assessments and spec 12 now name "a new payee"): Café Lumen was used for two different payees:
   - In the deck, the evidence run and the video, it is the known payee that the agent pays alone (T1).
   - It is cast as the unknown 300 USDC payee in `spec/12-submission.md` (step 4), in the README's demo line 3 ("refused on-chain (unknown payee)") and in the T2 row of the self-assessment's tier table.
   - The evidence run's new payee was another address (`0xab2b...699C`).
3. Fixed (EN and 中文): the README's demo line 2 (gold +20 %, the agent sells about 650 USD of tXAU) did not say "local fork". On Base Sepolia, prices come from Pyth, and the rebalance has only been shown on the fork.
4. Fixed in the brief (slide 9: "approved with the passkey in that run", "approval registered (passkey)", "In our iPhone test on the local fork"); spec 12 now points to the video script: storyboard step 4 in spec 12 puts the WeChat Face ID approval among the real Base Sepolia transactions, and deck slide 9 shows the three Base Sepolia transactions under a WeChat title. In the evidence run, the approval used the passkey. The WeChat Face ID approval and its replay refusal were tested on the iPhone against the local fork. The speaker notes for slide 9 say so.
5. Fixed in the speaker notes, the video script and both subtitle files (they now name the KYC level, risk profile and country, as the brief does); the I19 row already lists the attributes. Personal data on-chain:
   - The deck and the video said "identifiers, hashes and a country code".
   - Invariant I19 in the self-assessment says "only addresses, amounts and hashes".
   - D69 and known risk 27 also put the KYA's kycLevel and riskProfile on Base.
   - The most precise wording is risk 27's: pseudonymous attributes (kycLevel, riskProfile, a two-letter jurisdiction).
6. Fixed: `docs/MANUAL.md` 5.7 expected a replayed approval to land as TIER2_INVALID. The hook never returns it (D65): the same approval sent again reverts DigestUsed (I5), a counter that is not higher reverts BadSoter (I6). The iPhone test observed DigestUsed, which is what the self-assessment (risk 16) records.
7. Noted in spec 12's dated note: `spec/12-submission.md` asks for FISCO hashes "with WeBASE links". WeBASE is not part of the stack (D4), so EVIDENCE.md lists FISCO hashes without links.
8. Fixed by hand in EVIDENCE.md (its header says so; a regeneration from `.run/evidence/base-sepolia.json` would restore the old title): the flow title F5b, "Prompt injection to a sanctioned address: refused on-chain (SANCTIONED)", could be read as if the model's own attempt was refused. The flow's notes show that the model declined and that the agent-key operation was the one refused.
9. The deck PDF now in the working tree (`docs/Praetor Pitch.pdf`, 15 slides, built before brief v2; the speaker notes follow the 13 slides of v2):
   - Slide 9 says "3 stopped by the contract, 9 declined by the model". The correct split is 2 stopped by the contract, 1 by the agent runner and 9 declined by the model.
   - Slides 10 and 13 give the 6.3 s ("in our phone test", "Base enforces, in 6.3 s") without "local fork".
   - Slide 12's "Tested on a real iPhone, 270 USDC approved" does not say "local fork" either.
   - Slide 11's "Personal data never leaves the bank" is stronger than the facts: identifiers, hashes and a country code are on-chain.
   - Slide 9's "1,000+ automated tests" is not in the brief and was not checked against the test runners' totals: verify it or drop it.
   - The earlier `docs/Praetor-pitch.pptx` (14 slides, 2026-10-18) had the same kind of drift; it was removed from the repo on 2026-10-19 and the final deck replaces it.
   - Brief v2 changed on 2026-10-19 after its upload: slide 6 drops "on the 1st" ("Rent paid via Alipay+ (standing order, payout partner)"), and slide 9 marks the Base Sepolia approval as the passkey's and the iPhone test as on the local fork.

## 4. Final pre-submit checklist

Run from the repository root on the commit you submit.

- [ ] **No secrets.** `make test` (it runs gitleaks over the whole history) is green. `git ls-files | grep -E '(^|/)\.env$'` prints nothing. No secret of `.env` appears in the PDFs or the pitch files: run [the secret check](#the-secret-check-of-the-pdfs-and-pitch-files) at the end of this file, which prints variable names only, never values.
- [ ] **Links.** `pnpm -s exec tsx scripts/checks/links.ts` (part of `make test`) passes. The ten transactions above open on BaseScan. In each PDF, an internal link (for example "section 9" in the self-assessment) jumps to its section, and a repository link opens GitHub (after the judges have access).
- [ ] **PDFs open.** `pdfinfo docs/submission/*.pdf` shows A4 and the page count. Open each PDF once: the ARCHITECTURE PDF shows its six diagrams, and no page shows "Syntax error". The deck PDF and PPTX open.
- [ ] **No em dash.** `bash scripts/checks/no-emdash.sh` passes (it scans tracked text files). The PDFs are binary, so check their text as well: `for f in docs/submission/*.pdf "docs/Praetor Pitch.pdf"; do pdftotext "$f" - | grep -cP '\x{2014}'; done` prints only zeros. The PDF build refuses to finish if the U+2014 character is in a PDF it renders.
- [ ] **Versions.**
  - Each PDF's footer gives the commit it was built from. After the last change to the README, ARCHITECTURE, SELF_ASSESSMENT or EVIDENCE, rebuild with `bash scripts/submission/build-pdfs.sh` (pandoc, poppler-utils, the web app's Playwright Chromium and the network for the fonts and mermaid; in a git worktree without `node_modules`, set `PLAYWRIGHT_FROM=<main checkout>/apps/web`). It reads the Markdown as committed at HEAD, so uncommitted edits stay out: commit the sources first (or set `SOURCE=worktree`). It renders A4 with page numbers, working links, the mermaid diagrams and IBM Plex, and EVIDENCE.pdf as EVIDENCE-SERVER.md followed by EVIDENCE.md. It checks images, internal anchors, mermaid errors and em dashes, then writes `docs/submission/*.pdf`.
  - Commit the new PDFs and tag that commit `submission`.
  - The addresses in the README and ARCHITECTURE match `infra/deployments/base-sepolia.json`.
  - The dates in the documents are those of the submission.
- [ ] **Deck.** Every bracketed placeholder is replaced, the three QR codes scan, the talk takes at most 10 minutes, and the Chinese subtitle under each title is present.
- [ ] **Video.** At most 5:00. The Chinese subtitles are attached or burned in. Every FORK or EVIDENCE part is labelled on screen.
- [ ] **The form.** GitHub link, https://app.praetorwallet.com, [TODO: VIDEO_URL], the four PDFs and the deck are uploaded before 16:00 UTC.

### The secret check of the PDFs and pitch files

Run from the repository root. It compares every `.env` value whose name looks secret (key, secret, token, password, HMAC, private, cert) with the text of the PDFs and of `docs/pitch`, and prints only the names of the variables it finds:

```bash
python3 - <<'EOF'
import pathlib, re, subprocess
env = dict(l.split('=', 1) for l in pathlib.Path('.env').read_text().splitlines() if '=' in l and not l.lstrip().startswith('#'))
secret = {k: v.strip().strip('"') for k, v in env.items() if re.search(r'KEY|SECRET|TOKEN|PASS|HMAC|PRIVATE|CERT', k) and len(v.strip().strip('"')) >= 16}
texts = [subprocess.run(['pdftotext', str(p), '-'], capture_output=True, text=True).stdout for p in pathlib.Path('docs/submission').glob('*.pdf')]
texts += [p.read_text() for p in pathlib.Path('docs/pitch').iterdir() if p.suffix in ('.md', '.srt')]
found = sorted({k for k, v in secret.items() for t in texts if v in t or v.lower().removeprefix('0x') in t.lower()})
print('secret values found for:', ', '.join(found) if found else 'none')
EOF
```
