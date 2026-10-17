# Phase 0 subset. M0 extends this Makefile (up, down, test-int, e2e, ...).
.PHONY: setup test test-guards test-scripts

setup:
	git config core.hooksPath scripts/git-hooks
	@echo "commit-msg hook installed (core.hooksPath=scripts/git-hooks)"

test: test-guards test-scripts

test-scripts:
	pnpm -s test:scripts

test-guards:
	bash scripts/git-hooks/test-commit-msg.sh
	bash scripts/checks/no-emdash.sh
