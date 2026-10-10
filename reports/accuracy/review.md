# Accuracy acceptance review

Integrated acceptance: PASS. Task 1–3 independent stage gates are closed and current-source restart smoke passes. The manager will run a final whole-branch review after this report commit.

Task1 independent review: specification/quality PASS, no Critical/Important findings. Task2 initial review found cross-modal text-identity validation and unnecessary dense work; owner correction7dbcccc and scoped re-review cleared both, then qualified alias activation completed. Task3 review found oversized first-source envelopes could starve later usable sources; owner correction1aa8f67 adds source fairness and two regressions. Task4 independently ran covering32 tests after that fix; scoped independent re-review passed with 2 regressions and 2,000 independent budget/source-order assertions.

Task4 is read-only on product code. Independent raw audit verified 78 artifacts / 35 original source hashes against original measured commita89afb8, recomputed every row/aggregate metric, complete metadata positives and disjoint category splits. Reports keep overall metrics, natural-language subsets, language/group deltas and exact IDs separate; failure denominators/ranges are preserved. Config/vocabulary/query/qrel hashes stay frozen. Holdout was not rerun or tuned.

Fresh integrated gates: initial full 198/1slow skip; current focused 32; real ES 4; UI 12/build; both diff checks PASS. Owner current full 200/1skip is separately attributed. Browser actual API tested ready/search/select/source choices/error503/selection clearing. Distinct SCRIPTED QA server tested citations/excerpts/unavailable sources/experimental policy/link/relevance/history/cancellation; no semantic accuracy follows.

Embedding compatibility, alias pinning/rollback and bounded malformed/blank citation repair are covered by Task2/3 tests and reviewed contracts. Unknown legacy revision remains unknown. Actual image probes 20/20 establish identity only. Real LLM/review semantic measurements remain null. Model instructions for language/conflict/partial insufficiency are not a semantic verifier. Source fairness can still omit metadata envelopes too large for the configured budget; diagnostics must expose omissions.

After scoped re-review PASS, the owner restarted current-source API1aa8f67. Task 4 independently verified ready200, lowercase exact-ID hybrid top1, natural-language10results and missing-key503llm_unavailable. Reports are qualified for the final whole-branch review; that subsequent review is not claimed complete here. No additional owner code changes, benchmark tuning or dependency additions were made by Task4.

Skipped: real LLM/review judgment and cross-view visual relevance. Risk: narrow metadata labels and30 holdout rows limit general accuracy claims.

Report audit correction: initial exact-ID counts used Python boolean identity on numeric raw hit values, incorrectly displaying zero. Counts are now independently derived from first-ranked IDs against full qrels with every attempt in the denominator and asserted against numeric raw hits/aggregate rates. Image wording now says transformed catalog-image identity: all 20 query JPEGs differ from their source bytes and match the documented crop/resize/contrast/JPEG transform. Raw metrics, source files and inputs remain unchanged.
