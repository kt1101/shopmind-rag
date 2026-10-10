# ShopMind Accuracy Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The parent agent manages; subagents implement and review.

**Goal:** Improve current ShopMind retrieval and evidence-based answers, and publish reproducible, honestly scoped before/after results.

**Architecture:** Freeze metadata-grounded development/holdout labels first, capture the existing baseline, then fix the embedding/retrieval and evidence pipelines. Reuse existing API contracts and measure each stage independently; real semantic answer correctness is nullable.

**Tech Stack:** Python 3.11+, FastAPI/Pydantic, Elasticsearch 8, Torch/Transformers SigLIP2, NumPy, pytest; existing React/Vite frontend.

**Spec:** `docs/superpowers/specs/2026-10-09-shopmind-accuracy-design.md`

## Global Constraints

- Parent coordinates only; subagents own implementation and independent review. Never overlap file ownership.
- Preserve `reports/a1/slides/`, existing A1 labels, old embedding artifacts/index, and configured secrets.
- Backend branch `codex/accuracy-improvement` starts at assignment-A3 commit `923ddb12ab435d86ed24a78889116019c862556d`; frontend branch `codex/accuracy-improvement-ui` starts at `codex/assignment-a3-ui`. Reuse the current checkout/ignored assets.
- Freeze corpus/labels before tuning; seed 42, category-grouped 70% dev/30% holdout, complete positive relevance.
- API shape remains compatible; optional diagnostic metadata only. No new mandatory dependency.
- Batch cosine target >=0.99999; exact-ID top-1 100%; holdout nDCG target +0.05 absolute with no MRR/Recall regression; image identity no regression.
- Synthetic/metadata labels are not human reviewed. No configured real LLM/evidence means semantic answer correctness remains null.

## Review Focus

- Equivalent English/Vietnamese query variants must not cross splits or receive conflicting positives — Task 1.
- A duplicate relevant result must consume rank without taking repeated gain; a failed request must lower primary quality — Task 1.
- Identical model dimensions with different model revision/preprocessing must still reject incompatible artifacts — Task 2.
- Long, escaped evidence must remain valid JSON within budget, retain provenance, and disclose truncation — Task 3.
- A delayed answer for product A must not appear after the UI selects product B — Task 3.

---

### Task 1: Freeze a valid benchmark and correct evaluation accounting

**Owner:** evaluation agent. **Files:** create `scripts/build_accuracy_benchmark.py`, `evaluation/benchmarks/accuracy_v2/{queries,qrels}.jsonl`, `manifest.json`, `README.md`, and `tests/evaluation/test_accuracy_benchmark.py`; modify `evaluation/{metrics,datasets,runner,reports}.py`, `evaluation/rag/{metrics,runner}.py`, `tests/unit/test_metrics.py`, `tests/evaluation/test_runner.py`, `tests/a3/test_a3_eval.py`. Own only those files until this gate passes.

**Interfaces:** `build_accuracy_benchmark(products_path: str | Path, output_dir: str | Path, *, seed: int = 42) -> Path` writes query rows compatible with `load_queries`, plus optional `split`/`intent_id` provenance; all positive IDs are written in existing qrel shape. Extend `EvaluationQuery` with trailing optional provenance fields. Existing runner callers remain valid; `metrics` becomes all-attempt scoring and `metrics_successful_only`/`success_rate` are added to exports. RAG classification recognizes explicit failed semantic grades while unknown grades remain null.

- [x] Write regression tests asserting duplicate nDCG stays <=1 and the second duplicate adds zero gain, one success/one runtime failure yields primary nDCG 0.5 and successful-only 1.0, null semantic grade is not interpreted as success, and explicit semantic score 0 yields `wrong_answer`.
- [x] Run `pytest -q tests/unit/test_metrics.py tests/evaluation/test_runner.py tests/a3/test_a3_eval.py` and retain the expected new failures.
- [x] Implement complete predicate qrels using fixed documented aliases, exact brands, <=20 matching positives, unique text, and category-grouped seed-42 split. Add at most 60 paired predicate groups and 40 exact-ID probes; record actual counts when corpus availability limits the selection. Benchmark tests assert equivalent variants share positives/split, dev/holdout positive products are disjoint, frozen hashes reproduce, and each qrel satisfies its predicate.
- [x] Correct duplicate gain centrally, failed-attempt denominators in both runners, strict provenance loading, and explicit semantic failure classification. Preserve successful-only measures as clearly labeled diagnostics; RAG grader-free metrics stay null. Clarify that existing citation coverage means presence, not claim support.
- [x] Run `python -m scripts.build_accuracy_benchmark --products data/a1_abo_1500/products.jsonl --output evaluation/benchmarks/accuracy_v2 --seed 42` then `pytest -q tests/evaluation tests/unit/test_metrics.py tests/a3/test_a3_eval.py`. Expected: reproducible benchmark and all tests pass.
- [x] Record benchmark hashes in the plan/report, request an independent reviewer, resolve feedback, then commit only owned files as `fix: establish trustworthy accuracy benchmarks`.

### Task 2: Measure and fix real embedding/retrieval failures

**Owner:** retrieval agent after Task 1 review. **Files:** `shopmind/app/embedding/siglip2.py`, product/knowledge embedding artifact modules, relevant Elasticsearch/retrieval/knowledge code, runtime wiring in `shopmind/app/main.py`, `shopmind/app/core/config.py`, `configs/{app,retrieval}.yaml`, product/knowledge generation and index creation/indexing scripts, new `scripts/diagnose_embedding_accuracy.py`, related existing embedding/integration tests. Evaluation agent continues to own frozen benchmark and reports. Task 3 starts only after shared knowledge/runtime contracts are finalized.

**Interfaces:** Existing `SigLIP2EmbeddingProvider.embed_texts(texts) -> np.ndarray` and artifact load/write contracts stay usable. Manifest/index preprocessing identity is additive; compatible old assets remain available for baseline. Diagnostic CLI writes JSON actual cosine/identity measurements. Use new artifact directory `data/embeddings/abo_accuracy_v2` and index `products_accuracy_20261009_v2`; never overwrite baseline assets.

- [x] Start available cached Elasticsearch/CPU model runtime; validate 1,500 baseline documents or build an isolated baseline index from old cached vectors. Capture baseline BM25/hybrid/dense on frozen dev and holdout before changing inference, artifacts or alias. Store raw per-query output and corpus/model/index/config hashes under `runs/accuracy/`.
- [x] Add regressions for standalone-versus-mixed-batch invariance, invalid/nonfinite/zero vectors, artifact preprocessing/revision mismatch, and lowercase exact-ID top-1 in hybrid. Run focused tests and observe new failures.
- [x] Run actual model batch probes on short, long, English, Vietnamese, punctuation/ID texts. If dynamic padding fails cosine >=0.99999, set consistent maximum-length padding for indexing/querying, pin the actual cached revision, record preprocessing identity and regenerate all1,500 vectors into the new directory/index. Emit diagnostic before/after JSON. If real execution fails, preserve assets and report exact unavailable checks.
- [x] Enforce exact-ID lookup before semantic fusion and validate knowledge/query vector identity at shared boundaries. Select among current BM25, corrected dense, equal RRF and a lexical-preserving hybrid on dev only. Freeze the winner/config before holdout. Introduce language normalization only where fixed benchmark aliases and dev errors demonstrate a lexical mismatch; preserve original query and literal IDs in traces.
- [x] Run `pytest -q tests/unit/test_siglip2_adapter.py tests/unit/test_embedding_contract.py tests/unit/test_embedding_artifacts.py tests/unit/test_hybrid_retriever.py tests/integration`, actual CPU batch diagnostic, dev comparison and the frozen winner once on holdout; rerun existing20 image queries. Expected: compatibility/exactID/integration gates pass, targets recorded with actual counts and deltas.
- [x] Request independent review; after compatibility/count/smoke gates, switch the alias to the qualified new index, retain baseline target for rollback, and commit owned files as `fix: stabilize embeddings and retrieval accuracy`.

### Task 3: Tighten evidence, repair behavior, and frontend honesty

**Owner:** evidence/UI agent after Task 2 review. **Files:** `shopmind/app/rag/{context,citations,service}.py`, `shopmind/app/llm/openai_provider.py`, necessary knowledge retrieval code, `tests/a3/test_a3_service.py`, `tests/api/test_rag_api.py`, new `tests/a3/test_a3_quality.py`; frontend `/Users/yuji/research/rag/test-ui/src/{App.jsx,api.js,api.test.js}` and minimal related styling. Only this agent changes these files.

**Interfaces:** `/api/v1/rag/ask` request/response stays compatible. `RAGContext.metadata` adds truncation/source-availability diagnostics. Evidence JSON carries existing review/policy metadata. Generation attempts are bounded at two total for invalid citations, blank text and malformed structured output; exhaustion returns the existing controlled error path.

- [x] Write failing service/API fixtures for blank answer, malformed output then valid repair, repair exhaustion, conflicting reviews, absent rating metadata, wrong-product evidence, experimental policy and oversized/escaped context. Add UI regression for product A response arriving after selecting B.
- [x] Run `pytest -q tests/a3/test_a3_service.py tests/api/test_rag_api.py tests/a3/test_a3_quality.py` and frontend `npm test`; retain newly failing checks.
- [x] Whitelist review rating/verified/time/product linkage and policy version/provenance in context. Trim content to valid budgeted JSON, flag excerpts, and retain useful top evidence. Tighten validation/repair centrally and instructions for user language, conflicts, evidence gaps and experimental terms. No regex/string proxy claims semantic truth.
- [x] UI uses relevance/source labels, exposes missing/experimental/truncated evidence when present, and cancels/ignores obsolete answers on selection change. Keep product question flow and citation links intact.
- [x] Run focused checks, frontend `npm test && npm run build`, and API simulation against actual RAG service plus scripted provider. Expected: all adversarial behavior checks pass with synthetic provenance; real semantic accuracy remains null without key/evidence.
- [x] Request independent review, resolve owner-assigned feedback, then commit backend/frontend owned changes separately as `fix: preserve evidence and validate generated answers` / `fix: present product answer evidence faithfully`.

### Task 4: Integrated acceptance and independently reviewed result

**Owner:** verification/reviewer subagent; evaluation agent owns report edits; parent manages gate decisions.

**Files:** tracked `reports/accuracy/RESULTS.md`, `comparison.json`, `review.md`; reproducible full run artifacts remain in ignored `runs/accuracy/`. No product-code edits by reviewer or parent.

**Interfaces:** Consume frozen benchmark hashes, baseline/candidate exports, batch diagnostic output, synthetic answer fixture results and actual integration logs. Report metadata-grounded retrieval, image identity, scripted behavior and real semantic model quality separately.

- [x] Run `pytest -q`, integration against the running isolated Elasticsearch, frontend `npm test`/`npm run build`, and `git diff --check`; examine all failures/skips. Verify raw before/after rankings correspond to the same corpus/labels and frozen development choice.
- [x] Independent review checks category/query leakage, qrel completeness, failed-case denominators, metric ranges, alias rollback, model/preprocessing compatibility, bounded repair, correct product/source UI and experimental policy wording. Send concrete findings to original owners and rerun only affected gates after fixes.
- [x] Write actual split/group/language nDCG/MRR/Recall deltas, exact-ID hit counts, batch cosine range, image identity results, success rate and runtime versions. Include representative improved/still-failing queries and runnable reproduction commands. Record +0.05 holdout target as met/missed; no further heldout tuning. Label absent real LLM/reviews as unmeasured.
- [x] Commit report/review artifacts only after gates and independent review pass; return concise Vietnamese outcome with links to plan, measured result, key limitations, branch/commits and test outcomes. Do not represent a passing test count as answer accuracy.

## Completion

Tasks 1–4 and final independent review are complete. Final report head `10bd53b` passed scoped specification/quality re-review with the sole Important finding addressed. Product source is `1aa8f67`; frontend source is `c9fbfb2`. See `reports/accuracy/RESULTS.md` and `reports/accuracy/review.md` for measured outcomes and review closure. Real LLM/review semantic accuracy and independent image-view relevance remain unmeasured; completed checkboxes do not claim those measurements.
