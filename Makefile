# Praetor: one command per thing (spec 09, 10, 11).
SHELL := /bin/bash
.DEFAULT_GOAL := help

ENV_FILES := --env-file infra/.env.example $(if $(wildcard .env),--env-file .env)
COMPOSE := docker compose -f infra/compose.yml $(ENV_FILES)
# Profiles that exist so far; later milestones add chain, wecross, agent, tee-sim, mocks.
PROFILES ?= core dev
PROFILE_FLAGS := $(foreach p,$(PROFILES),--profile $(p))

.PHONY: help setup install up down ps logs test test-guards test-unit test-scripts test-contracts test-contracts-full test-fork lint gitleaks test-int e2e e2e-live redteam slither deploy-contracts tunnel

help: ## List targets
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## Install the commit-msg hook and dependencies
	git config core.hooksPath scripts/git-hooks
	@echo "commit-msg hook installed (core.hooksPath=scripts/git-hooks)"
	pnpm install --frozen-lockfile

up: ## Start the local stack (waits for healthchecks)
	$(COMPOSE) $(PROFILE_FLAGS) up -d --wait --build
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

gitleaks: ## Secret scan of history and uncommitted changes (I10)
	bash scripts/checks/gitleaks.sh

lint: ## Type-check every TypeScript package
	pnpm -s exec tsc -p tsconfig.json
	pnpm -s -r --if-present typecheck

test-unit: test-scripts test-contracts
	pnpm -s -r --if-present test

# Every commit: the quick fuzz profile. Milestone gate: `make test-contracts-full` (10k fuzz runs, spec 10).
test-contracts:
	cd contracts/base && FOUNDRY_PROFILE=quick forge test --no-match-path 'test/fork/*' -q

test-contracts-full: ## Base contracts with 10k fuzz runs and full invariants
	cd contracts/base && forge test --no-match-path 'test/fork/*'

test-fork: ## Base contracts fork tests on the real Safe7579 (needs network)
	cd contracts/base && forge test --match-path 'test/fork/*'

test-scripts:
	pnpm -s test:scripts

test-int: ## Integration tests, one per architecture link (needs make up)
	pnpm -s --filter @praetor/test test:int

e2e: ## Flows F1 to F10 against BASE_URL (default: local stack)
	pnpm -s --filter @praetor/test test:e2e

e2e-live: ## Flows on live Base Sepolia (CHAIN_MODE=live)
	CHAIN_MODE=live pnpm -s --filter @praetor/test test:e2e

redteam: ## Red-team suite (real model)
	@echo "redteam suite: M16" && exit 1

slither: ## Static analysis of the Base contracts (fails on unexplained High/Medium)
	bash scripts/checks/slither.sh

deploy-contracts: ## Deploy the Base contracts (ENV=fork|base-sepolia|sandbox)
	bash scripts/deploy/contracts.sh $(or $(ENV),fork)

tunnel: ## cloudflared tunnel in front of Caddy, URL in .run/tunnel-url
	@echo "tunnel: M13" && exit 1
