# Praetor: one command per thing (spec 09, 10, 11).
SHELL := /bin/bash
.DEFAULT_GOAL := help

ENV_FILES = --env-file infra/.env.example $(if $(wildcard .env),--env-file .env) $(if $(LIVE),--env-file infra/live.env) $(if $(wildcard .run/compose.env),--env-file .run/compose.env)
# LIVE=1 runs the stack on Base Sepolia (infra/live.env, LIVE_ keys, no anvil): the M16 evidence run (D74).
ifneq ($(LIVE),)
export CHAIN_MODE = live
endif
GRADLE_IMAGE = gradle@sha256:213476fe3598a433b19077b5b85ae95656cc0cba6fbc707d598c5a7ee865c52f
# PROD=1 adds the production overrides (M18 rehearsal, prod server).
COMPOSE = docker compose -f infra/compose.yml $(if $(PROD),-f infra/compose.prod.yml) $(ENV_FILES)
# Profiles that exist so far; later milestones add chain, wecross, agent, tee-sim, mocks.
PROFILES ?= core chain mocks tee-sim agent dev wecross
ifneq ($(LIVE),)
PROFILES := $(filter-out dev,$(PROFILES))
endif
PROFILE_FLAGS := $(foreach p,$(PROFILES),--profile $(p))

.PHONY: help setup install up down ps logs smoke-sm test test-guards test-unit test-scripts test-contracts test-wecross test-contracts-full test-fork lint gitleaks test-int e2e e2e-web e2e-smoke rehearsal e2e-live redteam slither deploy-contracts deploy-fisco tunnel reset-fork up-base

help: ## List targets
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## Install the commit-msg hook and dependencies
	git config core.hooksPath scripts/git-hooks
	@echo "commit-msg hook installed (core.hooksPath=scripts/git-hooks)"
	pnpm install --frozen-lockfile

up: ## Start the local stack (waits for healthchecks; deploys the contracts on a fresh fork)
	bash scripts/dev/compose-env.sh
	bash infra/fisco/gen.sh
	$(MAKE) --no-print-directory fisco-image
	$(MAKE) --no-print-directory up-base
	bash scripts/dev/sync-fork-time.sh
	bash scripts/dev/ensure-fork-deploy.sh
	pnpm -s --filter @praetor/web build
	$(COMPOSE) $(PROFILE_FLAGS) up -d --wait --build
	@if [ -f .run/deployments-changed ]; then $(COMPOSE) $(PROFILE_FLAGS) restart bundler bank regulator operator bridge-relayer && rm .run/deployments-changed; fi
	@case " $(PROFILES) " in *" wecross "*) bash scripts/wecross/up.sh ;; esac

reset-fork: ## Fresh anvil fork, contracts and consortium redeployed, services restarted
	$(COMPOSE) --profile dev rm -sf anvil
	docker volume rm praetor_anvil-state 2>/dev/null || true
	$(MAKE) --no-print-directory up

fisco-image: ## Build the FISCO node image once (the nodes never rebuild it: see infra/compose.yml)
	@docker image inspect praetor/fisco-bcos:3.17.1 >/dev/null 2>&1 || docker build -t praetor/fisco-bcos:3.17.1 infra/fisco

up-base:
	$(COMPOSE) --profile core $(if $(LIVE),,--profile dev) up -d --wait $(if $(LIVE),,anvil) mysql caddy
	@# The init script only runs on an empty volume; it is idempotent, so rerun it to add new service databases.
	$(COMPOSE) exec -T mysql bash /docker-entrypoint-initdb.d/01-databases.sh

down: ## Stop the local stack (volumes kept)
	$(COMPOSE) --profile '*' down --remove-orphans

ps: ## Show the stack
	$(COMPOSE) --profile '*' ps

logs: ## Follow logs (S=service)
	$(COMPOSE) --profile '*' logs -f $(S)

test: test-guards gitleaks lint test-unit ## Unit tests of every package + guards + gitleaks (before every commit)

test-guards:
	bash scripts/git-hooks/test-commit-msg.sh
	bash scripts/checks/no-emdash.sh
	pnpm -s exec tsx scripts/checks/links.ts

gitleaks: ## Secret scan of history and uncommitted changes (I10)
	bash scripts/checks/gitleaks.sh

lint: ## Type-check every TypeScript package
	pnpm -s exec tsc -p tsconfig.json
	pnpm -s -r --if-present typecheck

test-unit: test-scripts test-contracts test-wecross
	pnpm -r --if-present --reporter-hide-prefix test

test-wecross: ## The WeCross EVM stub's JUnit tests, in the pinned Gradle / JDK 8 image (no host JDK)
	docker volume create praetor-gradle >/dev/null
	docker run --rm -v praetor-gradle:/gradle $(GRADLE_IMAGE) chown $$(id -u):$$(id -g) /gradle
	docker run --rm -u $$(id -u):$$(id -g) -e GRADLE_USER_HOME=/gradle -v praetor-gradle:/gradle -v "$$PWD/wecross/evm-stub":/work -w /work $(GRADLE_IMAGE) gradle test --no-daemon -q

# Every commit: the quick fuzz profile. Milestone gate: `make test-contracts-full` (10k fuzz runs, spec 10).
test-contracts:
	cd contracts/base && FOUNDRY_PROFILE=quick forge test --no-match-path 'test/fork/*' -q
	cd contracts/fisco && FOUNDRY_PROFILE=quick forge test -q
	bash contracts/fisco/sm/assemble.sh
	cd contracts/fisco && FOUNDRY_PROFILE=sm forge test -q

test-contracts-full: ## Base and FISCO contracts with 10k fuzz runs and full invariants
	cd contracts/base && forge test --no-match-path 'test/fork/*'
	cd contracts/fisco && forge test

test-fork: ## Base contracts fork tests on the real Safe7579 (needs network)
	cd contracts/base && forge test --match-path 'test/fork/*'

test-scripts:
	pnpm -s test:scripts

test-int: ## Integration tests, one per architecture link (needs make up)
	pnpm -s --filter @praetor/test test:int

e2e: ## Flows F1 to F10 against BASE_URL (default: local stack), through the api and through the web app
	pnpm -s --filter @praetor/test test:e2e
	$(MAKE) --no-print-directory e2e-web
	@# Last: F10's recovery moves the fork's clock forward 48 h.
	pnpm -s --filter @praetor/test test:warp

e2e-smoke: ## Smoke subset of the flows (onboarding, agent payment, audit) against the running stack
	pnpm -s --filter @praetor/test exec vitest run --config vitest.e2e.config.ts e2e/F1-onboarding.test.ts e2e/F5-agent-payment.test.ts e2e/F8-audit.test.ts

rehearsal: ## M18: the stack with compose.prod.yml (PRAETOR_ENV=rehearsal), the smoke suite, then the prod refusals
	PRAETOR_ENV=rehearsal $(MAKE) --no-print-directory up PROD=1
	$(MAKE) --no-print-directory e2e-smoke
	bash scripts/deploy/prod-refusals.sh

e2e-web: ## The web app's journey F1 to F9 in Playwright (virtual authenticator), screenshots and axe (needs make up)
	pnpm -s --filter @praetor/web build
	pnpm -s --filter @praetor/web e2e

e2e-live: ## Flows on live Base Sepolia (CHAIN_MODE=live)
	CHAIN_MODE=live pnpm -s --filter @praetor/test test:e2e

redteam: ## Red-team suite (real model)
	@echo "redteam suite: M16" && exit 1

slither: ## Static analysis of the Base and FISCO contracts (fails on unexplained High/Medium)
	bash scripts/checks/slither.sh

smoke-sm: ## Guomi profile smoke: fresh SM chain, SM build, Java SDK checks, torn down (Docker, minutes; not in make test)
	bash infra/fisco/sm/run.sh

deploy-contracts: ## Deploy the Base contracts (ENV=fork|base-sepolia|sandbox)
	bash scripts/deploy/contracts.sh $(or $(ENV),fork)

deploy-fisco: ## FISCO governance bootstrap + consortium contracts (ENV=local|live|sandbox)
	pnpm -s exec tsx scripts/fisco/deploy.ts $(or $(ENV),local)

tunnel: ## cloudflared tunnel in front of Caddy, URL in .run/tunnel-url
	@echo "tunnel: M13" && exit 1
