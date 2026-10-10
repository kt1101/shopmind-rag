# Accuracy acceptance review

Integrated acceptance and final independent review: PASS. Task 1–4 independent stage gates are closed and current-source restart smoke passes. Final whole-branch review and scoped provenance re-review are complete at report head `10bd53b`; specification PASS, quality PASS, sole Important finding ADDRESSED. Product source remains `1aa8f67` and frontend source `c9fbfb2`; this closeout changes documentation only.

Task1 independent review: specification/quality PASS, no Critical/Important findings. Task2 initial review found cross-modal text-identity validation and unnecessary dense work; owner correction7dbcccc and scoped re-review cleared both, then qualified alias activation completed. Task3 review found oversized first-source envelopes could starve later usable sources; owner correction1aa8f67 adds source fairness and two regressions. Task4 independently ran covering32 tests after that fix; scoped independent re-review passed with 2 regressions and 2,000 independent budget/source-order assertions.

Task4 is read-only on product code. Independent raw audit verified 78 artifacts / 35 original source hashes against original measured commita89afb8, recomputed every row/aggregate metric, complete metadata positives and disjoint category splits. Reports keep overall metrics, natural-language subsets, language/group deltas and exact IDs separate; failure denominators/ranges are preserved. Config/vocabulary/query/qrel hashes stay frozen. Holdout was not rerun or tuned.

Fresh integrated gates: initial full 198/1slow skip; current focused 32; real ES 4; UI 12/build; both diff checks PASS. Owner current full 200/1skip is separately attributed. Browser actual API tested ready/search/select/source choices/error503/selection clearing. Distinct SCRIPTED QA server tested citations/excerpts/unavailable sources/experimental policy/link/relevance/history/cancellation; no semantic accuracy follows.

Embedding compatibility, alias pinning/rollback and bounded malformed/blank citation repair are covered by Task2/3 tests and reviewed contracts. Unknown legacy revision remains unknown. Actual image probes 20/20 establish identity only. Real LLM/review semantic measurements remain null. Model instructions for language/conflict/partial insufficiency are not a semantic verifier. Source fairness can still omit metadata envelopes too large for the configured budget; diagnostics must expose omissions.

After scoped re-review PASS, the owner restarted current-source API1aa8f67. Task 4 independently verified ready200, lowercase exact-ID hybrid top1, natural-language10results and missing-key503llm_unavailable. The final whole-branch review and scoped provenance re-review subsequently passed. No additional owner code changes, benchmark tuning or dependency additions were made by Task4.

Skipped: real LLM/review judgment and cross-view visual relevance. Risk: narrow metadata labels and30 holdout rows limit general accuracy claims.

Report audit correction: initial exact-ID counts used Python boolean identity on numeric raw hit values, incorrectly displaying zero. Counts are now independently derived from first-ranked IDs against full qrels with every attempt in the denominator and asserted against numeric raw hits/aggregate rates. Image wording now says transformed catalog-image identity: all 20 query JPEGs differ from their source bytes and match the documented crop/resize/contrast/JPEG transform. Raw metrics, source files and inputs remain unchanged.

Final QA provenance correction: refreshed only the SHA256 digests for `runs/accuracy/task4/audit.py` after the exact-ID count correction and `runs/accuracy/task4/scripted-server.log` after server shutdown finalized the log. All 21 referenced QA digests match their finalized files; historical measurement/source hashes are preserved. Independent scoped re-review verified every finalized digest against actual bytes and closed the finding with specification PASS / quality PASS. All historical fields remain unchanged, including 78 raw artifact hashes, measured/source hashes, metrics and selection provenance.

Review evidence archive: `runs/accuracy/review_archive/2026-10-09-shopmind-accuracy/` preserves the final reviews, task reports, ledger and Task 3 evidence. Restore this directory to `.superpowers/sdd/2026-10-09-shopmind-accuracy/` when reproducing commands using the historical workspace paths; do not rewrite recorded paths or hashes.

Ruling: use existing checkout with dedicated `codex/accuracy-improvement` branch — reuse ignored catalog/model assets and preserve assignment-a3 — cost if wrong: move commits to an isolated checkout.

Ruling: target research/demo A1/A3 on present hardware with metadata-grounded labels — user skipped optional preferences and asked to continue — cost if wrong: add real-store data and production acceptance later.
