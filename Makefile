# ShopMind developer tasks. Run `make` (or `make help`) for the list.
#
# Python modules run from api/, UI commands from ui/, docker compose from the repo root.
# Anything that loads SigLIP2 or another embedding model runs inside the `tools`
# container on CPU (the host Python 3.13 + MPS crashes while loading the model).

SHELL := /bin/sh
.DEFAULT_GOAL := help

PYTHON  ?= python
NPM     ?= npm
COMPOSE ?= docker compose

# --- A1 dataset / embedding / index versions --------------------------------
DATASET_DIR     ?= data/a1_abo_1500
DATASET_VERSION ?= abo_a1_1500_v1
INDEX_VERSION   ?= v1
INDEX_NAME      ?= products_a1_1500_$(INDEX_VERSION)
EMBEDDINGS_DIR  ?= data/embeddings/$(DATASET_VERSION)
APP_CONFIG      ?= configs/app.yaml
# Text embedder id from config (embedders.<id>); used by embed-text once supported.
TEXT_EMBEDDER   ?= text_e5
TEXT_EMBEDDINGS_DIR ?= data/embeddings/$(DATASET_VERSION)_$(TEXT_EMBEDDER)

# --- A3 policy index ----------------------------------------------------------
POLICY_VERSION ?= policies_a3_v1
POLICY_INPUT   ?= data/policies/shopmind_policies.jsonl

# --- Evaluation ---------------------------------------------------------------
A1_BENCHMARK ?= evaluation/benchmarks/a1
RAG_CASES    ?= data/evaluation/rag_cases.jsonl
# s0-s3 do not call the LLM; s4-s5 need OPENAI_API_KEY (override RAG_CONFIGS to include them).
RAG_CONFIGS  ?= configs/experiments/rag/s[0-3]_*.yaml

API_FAST_TESTS := tests/unit tests/api tests/evaluation tests/a3 tests/platform
TOOLS := $(COMPOSE) --profile tools run --rm -T tools

.PHONY: help setup up down logs ps test test-api test-ui test-integration lint build-ui \
        seed index embed embed-siglip embed-text index-policies eval-a1 eval-rag clean

help: ## Show this help
	@echo "Usage: make <target> [VAR=value]"
	@echo
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@echo "Variables: DATASET_VERSION=$(DATASET_VERSION) INDEX_VERSION=$(INDEX_VERSION) INDEX_NAME=$(INDEX_NAME)"

## ---- Setup and stack ----

setup: ## Install API (editable, dev extras) and UI dependencies on the host
	cd api && $(PYTHON) -m pip install -e '.[dev]'
	cd ui && $(NPM) ci

up: ## Build and start elasticsearch, postgres, api and frontend
	$(COMPOSE) up -d --build

down: ## Stop the stack (named volumes are kept)
	$(COMPOSE) down

logs: ## Follow logs of all running services
	$(COMPOSE) logs -f --tail=200

ps: ## Show service status and health
	$(COMPOSE) ps

## ---- Tests and quality ----

test: test-api test-ui ## Run fast API tests and UI tests

test-api: ## Fast API tests (no Elasticsearch, no real model)
	cd api && $(PYTHON) -m pytest $(API_FAST_TESTS) -q

test-ui: ## UI unit tests
	cd ui && $(NPM) test

test-integration: ## Integration tests (needs Elasticsearch on :9200, e.g. `make up`)
	cd api && $(PYTHON) -m pytest tests/integration -m integration -q

lint: ## ruff (pyflakes rules) + UI production build
	cd api && ruff check shopmind evaluation scripts tests
	cd ui && $(NPM) run build

build-ui: ## Production build of the UI into ui/dist
	cd ui && $(NPM) run build

## ---- Data, indexing, evaluation ----

seed: ## Seed demo data and the admin account (runs scripts.seed_demo in the api container)
	$(COMPOSE) exec -T api python -m scripts.seed_demo

embed: embed-siglip embed-text ## Generate SigLIP2 + text-embedder artifacts (docker, CPU)

embed-siglip: ## SigLIP2 text/image embeddings -> data/embeddings/<DATASET_VERSION>
	$(TOOLS) python -u -m scripts.generate_embeddings \
	  --input /app/$(DATASET_DIR)/products.jsonl \
	  --output-dir /app/$(EMBEDDINGS_DIR) \
	  --config /app/$(APP_CONFIG) \
	  --dataset-version $(DATASET_VERSION) \
	  --device cpu \
	  --force

embed-text: ## Dedicated text-embedder artifacts (TEXT_EMBEDDER; skipped until supported)
	$(TOOLS) sh -c ' \
	  if python -m scripts.generate_embeddings --help | grep -q -- "--embedder"; then \
	    python -u -m scripts.generate_embeddings \
	      --input /app/$(DATASET_DIR)/products.jsonl \
	      --output-dir /app/$(TEXT_EMBEDDINGS_DIR) \
	      --config /app/$(APP_CONFIG) \
	      --dataset-version $(DATASET_VERSION)_$(TEXT_EMBEDDER) \
	      --embedder $(TEXT_EMBEDDER) \
	      --device cpu \
	      --force; \
	  else echo "skip embed-text: scripts.generate_embeddings has no --embedder option yet"; fi'

index: ## Create INDEX_NAME from artifacts and switch the products alias (needs ES on :9200)
	cd api && $(PYTHON) -m scripts.create_index \
	  --manifest $(EMBEDDINGS_DIR)/manifest.json \
	  --index-name $(INDEX_NAME) \
	  --recreate
	cd api && $(PYTHON) -m scripts.index_products \
	  --products $(DATASET_DIR)/products.jsonl \
	  --embeddings $(EMBEDDINGS_DIR) \
	  --index-name $(INDEX_NAME) \
	  --switch-alias products

index-policies: ## Embed (docker) and index the experimental policies, switch the policies alias
	$(TOOLS) python -u -m scripts.generate_knowledge_embeddings --source policy \
	  --input $(POLICY_INPUT) --dataset-version $(POLICY_VERSION) \
	  --output-dir data/embeddings/$(POLICY_VERSION) --force
	cd api && $(PYTHON) -m scripts.index_policies --input $(POLICY_INPUT) \
	  --embeddings data/embeddings/$(POLICY_VERSION) --index-name $(POLICY_VERSION) \
	  --switch-alias

eval-a1: ## A1 text ablation + image run on the seed-42 benchmark (docker, writes runs/a1)
	$(TOOLS) sh -c ' \
	  python -m evaluation.ablation \
	    --configs configs/experiments/bm25.yaml configs/experiments/dense.yaml \
	      configs/experiments/cross_modal.yaml configs/experiments/hybrid_no_rrf.yaml \
	      configs/experiments/hybrid_rrf.yaml \
	    --queries $(A1_BENCHMARK)/queries.jsonl \
	    --qrels $(A1_BENCHMARK)/qrels.jsonl \
	    --query-type text \
	    --runs-root runs/a1 && \
	  python -m evaluation.runner \
	    --config configs/experiments/image_dense.yaml \
	    --queries $(A1_BENCHMARK)/queries.jsonl \
	    --qrels $(A1_BENCHMARK)/qrels.jsonl \
	    --query-type image \
	    --runs-root runs/a1'

eval-rag: ## A3 s0-s3 progression (override RAG_CONFIGS for s4-s5; docker, writes runs/a3)
	$(TOOLS) sh -c 'python -m scripts.run_rag_experiment --configs $(RAG_CONFIGS) --cases $(RAG_CASES)'

## ---- Housekeeping ----

clean: ## Remove caches and build outputs (keeps data/, runs/ and docker volumes)
	find api -type d \( -name __pycache__ -o -name .pytest_cache -o -name .ruff_cache \) -prune -exec rm -rf {} +
	rm -rf api/shopmind.egg-info api/build ui/dist
