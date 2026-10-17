"""F6: shopping planner — "I'm moving into a studio, budget $800" → a cited, budget-aware basket.

RAG flow (every stage is a glass-box trace step):

1. ``decompose``      situation → 2-8 product needs (LLM structured output constrained to catalog
                      categories, or occasion templates from ``configs/vocab/occasions.yaml``).
2. ``retrieve`` ×N    one product search per need through the default search pipeline (category
                      filter, relaxed when it returns nothing), joined with synthetic price/stock.
3. ``optimize_budget`` pick one in-stock candidate per need maximizing relevance × priority under
                      the budget (exact dynamic programming over dollars; "nice" needs go first).
4. ``build_context`` chosen products + store-policy evidence, budgeted like the RAG context.
5. ``generate`` + ``validate_citations`` (LLM) or ``justify`` (no LLM): one reason per item and
                      policy tips, every claim citing evidence IDs that were in the context.

The planner never needs an LLM to produce a usable plan; the LLM only improves the decomposition
of free-form situations and the wording of reasons. Prices are synthetic and labelled as such.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from shopmind.application.rag.citations import CitationResolver, CitationValidationError
from shopmind.application.rag.context import ContextBuilder
from shopmind.application.retrieval.language import detect_language, known_colors
from shopmind.core.tracing import trace_step
from shopmind.domain.search_query import SearchMode, SearchRequest
from shopmind.domain.search_result import RetrievedDocument
from shopmind.infrastructure.llm.base import InvalidLLMOutput, LLMProviderError

DEFAULT_OCCASIONS = Path(__file__).resolve().parents[3] / "configs" / "vocab" / "occasions.yaml"
PRIORITY_WEIGHT = {"must": 10.0, "nice": 3.0}
_BUDGET = re.compile(r"(?:ngân\s*sách|budget|dưới|không\s*quá|tối\s*đa|khoảng|tầm|under|below|max(?:imum)?|around|about|up\s*to)\s*(?:là|of|is)?\s*\$?\s*(\d[\d.,]*)\s*(k|nghìn|ngàn|đô|usd|\$|dollars?)?", re.IGNORECASE)
_AMOUNT = re.compile(r"\$\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:đô|usd|\$|dollars?)\b", re.IGNORECASE)
_SITUATION = re.compile(r"(chuyển|chuẩn bị|dọn|đi |sắm|tặng|đón|mới|cho (bé|con|vợ|chồng|mẹ|bố|bạn)|moving|prepare|going|planning|set(ting)? up|new |for my)", re.IGNORECASE)
_POLICY_QUERIES = {"vi": ("chính sách đổi trả hàng hoàn tiền", "giao hàng vận chuyển thời gian"), "en": ("return policy refund window", "shipping delivery time")}
_SPLIT = re.compile(r"\s*(?:,|;|\bvà\b|\band\b|\bcùng\b|\bplus\b|\+)\s*", re.IGNORECASE)
_FILLER = re.compile(r"^(?:tôi|mình|em|anh|chị|i|we)?\s*(?:cần|muốn|đang tìm|tìm|need|want|looking for)?\s*(?:mua)?\s*", re.IGNORECASE)

DECOMPOSE_SCHEMA = {
    "type": "object",
    "properties": {
        "occasion": {"type": "string"},
        "budget": {"type": ["number", "null"]},
        "needs": {"type": "array", "items": {"type": "object", "properties": {
            "label": {"type": "string"}, "query": {"type": "string"},
            "categories": {"type": "array", "items": {"type": "string"}},
            "priority": {"type": "string", "enum": ["must", "nice"]},
        }, "required": ["label", "query", "categories", "priority"], "additionalProperties": False}},
    },
    "required": ["occasion", "budget", "needs"],
    "additionalProperties": False,
}
JUSTIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "items": {"type": "array", "items": {"type": "object", "properties": {"need_id": {"type": "string"}, "reason": {"type": "string"}, "citation_ids": {"type": "array", "items": {"type": "string"}}}, "required": ["need_id", "reason", "citation_ids"], "additionalProperties": False}},
        "tips": {"type": "array", "items": {"type": "object", "properties": {"text": {"type": "string"}, "citation_ids": {"type": "array", "items": {"type": "string"}}}, "required": ["text", "citation_ids"], "additionalProperties": False}},
        "insufficient_evidence": {"type": "boolean"},
    },
    "required": ["summary", "items", "tips", "insufficient_evidence"],
    "additionalProperties": False,
}


class PlanRequestError(ValueError):
    """The request cannot be planned (empty after cleaning, invalid budget…)."""


@dataclass
class Need:
    id: str
    label: str
    query: str
    categories: list[str]
    priority: str = "must"
    candidates: list[dict[str, Any]] = field(default_factory=list)


def _text(value: Any, language: str) -> str:
    if isinstance(value, dict):
        return str(value.get(language) or value.get("en") or next(iter(value.values()), ""))
    return str(value or "")


def _number(raw: str, unit: str | None) -> float:
    cleaned = raw.replace(",", "") if raw.count(",") and not raw.count(".") and len(raw.split(",")[-1]) == 3 else raw.replace(",", ".")
    value = float(cleaned.rstrip("."))
    return value * 1000 if (unit or "").casefold() in {"k", "nghìn", "ngàn"} else value


def parse_budget(text: str) -> float | None:
    """Budget in USD stated in the request ("ngân sách 800 đô", "under $500", "300$")."""
    match = _BUDGET.search(text)
    if match:
        return _number(match.group(1), match.group(2))
    match = _AMOUNT.search(text)
    if match:
        return _number(match.group(1) or match.group(2), None)
    return None


def optimize_budget(options: list[list[tuple[float | None, float]]], budget: float | None) -> list[int | None]:
    """Choose at most one option per need, maximizing total utility with Σ price ≤ budget.

    ``options[i] = [(price, utility), …]``; a ``None`` price counts as 0. Without a budget the
    highest-utility option of every need is taken. Exact DP over whole dollars (scaled for large
    budgets), so a cheaper set of must-haves beats one expensive extra.
    """
    if budget is None:
        return [max(range(len(opts)), key=lambda j: opts[j][1]) if opts else None for opts in options]
    unit = max(1.0, math.ceil(budget / 5000))
    capacity = int(budget // unit)
    neg = float("-inf")
    best = [0.0] + [neg] * capacity  # best[c] = max utility spending exactly c units
    choices: list[list[int | None]] = []
    for opts in options:
        new = list(best)
        pick: list[int | None] = [None] * (capacity + 1)
        for j, (price, utility) in enumerate(opts):
            cost = int(math.ceil((price or 0.0) / unit - 1e-9))
            if cost > capacity:
                continue
            for c in range(capacity, cost - 1, -1):
                if best[c - cost] > neg and best[c - cost] + utility > new[c]:
                    new[c] = best[c - cost] + utility
                    pick[c] = j
        choices.append(pick)
        best = new
    c = max(range(capacity + 1), key=lambda k: (best[k], -k))
    selected: list[int | None] = [None] * len(options)
    for i in range(len(options) - 1, -1, -1):
        j = choices[i][c]
        selected[i] = j
        if j is not None:
            c -= int(math.ceil((options[i][j][0] or 0.0) / unit - 1e-9))
    return selected


class ShoppingPlanner:
    def __init__(self, search, rag_service, prompts, *, commerce=None, catalog_values=None, occasions_path: str | Path | None = None, candidates_per_need: int = 5, default_pipeline: str | None = None) -> None:
        self.search = search
        self.rag = rag_service
        self.prompts = prompts
        self.commerce = commerce
        self.catalog_values = catalog_values
        self.candidates_per_need = candidates_per_need
        self.default_pipeline = default_pipeline
        path = Path(occasions_path) if occasions_path else DEFAULT_OCCASIONS
        self.occasions = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("occasions", {}) if path.exists() else {}

    # --- public --------------------------------------------------------------------------------

    def plan(self, request: str, *, budget: float | None = None, language: str | None = None, max_needs: int = 6) -> dict[str, Any]:
        text = " ".join(request.split())
        if len(text) < 3:
            raise PlanRequestError("describe what you are shopping for")
        language = language or detect_language(text)
        budget = budget if budget is not None else parse_budget(text)
        if budget is not None and budget <= 0:
            raise PlanRequestError("budget must be positive")
        llm = getattr(self.rag, "llm", None) if self.rag is not None else None
        notes: list[str] = []
        with trace_step("decompose", impl="llm" if llm is not None and hasattr(llm, "generate_structured") else "rules", params={"max_needs": max_needs}) as step:
            occasion, needs, method, llm_budget = self._decompose(text, language, max_needs, llm, notes)
            if budget is None and llm_budget:
                budget = llm_budget
            step.set_details(occasion=occasion, budget=budget, needs=[{"id": n.id, "label": n.label, "query": n.query, "categories": n.categories, "priority": n.priority} for n in needs])
            step.set_summary(f"{len(needs)} needs via {method}" + (f" (occasion {occasion['id']})" if occasion and occasion.get("id") else ""))
        for need in needs:
            self._retrieve(need, text)
        with trace_step("optimize_budget", impl="dp", params={"budget": budget}) as step:
            options = [[(c["price"]["amount"] if c.get("price") else None, PRIORITY_WEIGHT[n.priority] * (0.6 + 0.4 * c["relevance"])) for c in n.candidates if c.get("in_stock") is not False] for n in needs]
            selected = optimize_budget(options, budget)
            chosen: dict[str, dict[str, Any] | None] = {}
            for need, opts_choice in zip(needs, selected, strict=True):
                in_stock = [c for c in need.candidates if c.get("in_stock") is not False]
                chosen[need.id] = in_stock[opts_choice] if opts_choice is not None else None
            total = round(sum((item["price"]["amount"] if item and item.get("price") else 0.0) for item in chosen.values()), 2)
            step.set_details(choices={need.id: (chosen[need.id] or {}).get("product_id") for need in needs}, total=total)
            step.set_summary(f"{sum(1 for item in chosen.values() if item)}/{len(needs)} needs filled, total {total:.2f}" + (f" ≤ {budget:.2f}" if budget is not None else " (no budget)"))
        documents, policy_docs = self._evidence(needs, chosen, text, language)
        builder = ContextBuilder(max(1, len(documents) + len(policy_docs)), {"product": max(1, len(documents)), "policy": 3}, 24000)
        with trace_step("build_context", impl="budgeted") as step:
            context = builder.build(documents + policy_docs)
            step.set_details(documents=[{"id": d.id, "source": d.source, "chars": len(d.content), "included": d.id in context.citation_ids} for d in documents + policy_docs], rendered_chars=context.metadata.get("context_characters"))
            step.set_summary(f"{len(context.citation_ids)} evidence documents")
        result = None
        if llm is not None and hasattr(llm, "generate_structured") and documents:
            result = self._justify_llm(llm, text, language, needs, chosen, budget, total, context)
            if result is None:
                notes.append("llm_justification_failed: extractive reasons used")
        if result is None:
            with trace_step("justify", impl="extractive") as step:
                result = self._justify_rules(language, occasion, needs, chosen, budget, total, documents, policy_docs)
                step.set_summary(f"{len(result['items'])} reasons from product facts, {len(result['tips'])} policy tip(s)")
        cited = [cid for item in result["items"] for cid in item["citation_ids"]] + [cid for tip in result["tips"] for cid in tip["citation_ids"]]
        sources = CitationResolver().resolve(tuple(dict.fromkeys(cid for cid in cited if cid in context.citation_ids)), context.documents)
        from shopmind.application.chat.service import citation_payload

        reasons = {item["need_id"]: item for item in result["items"]}
        need_payload = []
        for need in needs:
            item = chosen[need.id]
            status = "chosen" if item else ("no_match" if not need.candidates else "skipped_budget")
            reason = reasons.get(need.id, {})
            need_payload.append({"id": need.id, "label": need.label, "query": need.query, "categories": need.categories, "priority": need.priority, "status": status, "chosen": item, "alternatives": [c for c in need.candidates if not item or c["product_id"] != item["product_id"]][:3], "reason": reason.get("reason") or self._status_reason(status, language), "citation_ids": reason.get("citation_ids", [])})
        notes.append("prices_are_synthetic")
        return {
            "request": text, "language": language, "method": "llm" if "llm" in (method, result.get("method")) else "rules",
            "occasion": occasion, "budget": budget, "currency": "USD", "total": total,
            "within_budget": budget is None or total <= budget + 1e-6, "summary": result["summary"],
            "needs": need_payload, "tips": result["tips"], "sources": [citation_payload(source) for source in sources],
            "insufficient_evidence": bool(result.get("insufficient_evidence")) or not any(chosen.values()), "notes": notes,
        }

    # --- decomposition -------------------------------------------------------------------------

    def _decompose(self, text: str, language: str, max_needs: int, llm, notes: list[str]):
        if llm is not None and hasattr(llm, "generate_structured"):
            try:
                return self._decompose_llm(text, language, max_needs, llm)
            except (LLMProviderError, InvalidLLMOutput, ValueError) as exc:
                notes.append(f"llm_decompose_failed: {type(exc).__name__}; occasion templates used")
        occasion, needs = self._decompose_rules(text, language, max_needs)
        return occasion, needs, "rules", None

    def _match_occasion(self, text: str) -> tuple[str, dict[str, Any]] | None:
        lowered = text.casefold()
        scored = []
        for key, spec in self.occasions.items():
            hits = sum(1 for keyword in spec.get("keywords", []) if re.search(rf"(?<!\w){re.escape(str(keyword).casefold())}(?!\w)", lowered))
            if hits:
                scored.append((hits, key))
        if not scored:
            return None
        key = max(scored)[1]
        return key, self.occasions[key]

    def _decompose_rules(self, text: str, language: str, max_needs: int) -> tuple[dict[str, Any] | None, list[Need]]:
        """Explicit item lists win ("a black backpack, a bottle and running shoes"); otherwise the
        best-matching occasion template; otherwise the whole request is one need."""
        colors = sorted({canonical for spelling, canonical in known_colors().items() if re.search(rf"(?<!\w){re.escape(spelling)}(?!\w)", text, re.IGNORECASE)})
        suffix = (" " + " ".join(colors)) if colors else ""
        stripped = _AMOUNT.sub(" ", _BUDGET.sub(" ", text))
        parts = [_FILLER.sub("", part).strip(" .!?") for part in _SPLIT.split(stripped)]
        parts = [re.sub(r"^(?:a|an|some|một|vài|cái|chiếc|đôi|bộ)\s+", "", part, flags=re.IGNORECASE) for part in parts if len(part.strip()) >= 3]
        # A part describes the situation (not an item) when it names an occasion with a verb or detail:
        # "chuẩn bị đi biển 5 ngày" / "mới chuyển nhà" vs. the item "running shoes".
        situation_parts = [part for part in parts if self._match_occasion(part) and (len(part.split()) >= 4 or _SITUATION.search(part))]
        item_parts = [part for part in parts if part not in situation_parts]
        matched = self._match_occasion(text)
        if len(item_parts) >= 2 or (item_parts and not matched):
            occasion = {"id": matched[0], "label": _text(matched[1].get("label"), language)} if matched and situation_parts else {"id": "custom", "label": "Theo danh sách của bạn" if language == "vi" else "Your list"}
            return occasion, [Need(f"n{i}", part[:60], part, [], "must") for i, part in enumerate(item_parts[:max_needs], start=1)]
        if matched:
            key, spec = matched
            ordered = sorted(spec.get("needs", []), key=lambda need: need.get("priority", "must") != "must")[:max_needs]
            needs = [Need(f"n{i}", _text(need.get("label"), language), str(need.get("query", "")) + suffix, list(need.get("categories", [])), need.get("priority", "must")) for i, need in enumerate(ordered, start=1)]
            return {"id": key, "label": _text(spec.get("label"), language)}, needs
        return {"id": "custom", "label": "Theo yêu cầu" if language == "vi" else "Custom request"}, [Need("n1", stripped.strip()[:60], stripped.strip(), [], "must")]

    def _decompose_llm(self, text: str, language: str, max_needs: int, llm):
        categories = list(self.catalog_values("category")) if self.catalog_values else []
        matched = self._match_occasion(text)
        hint = f"\nClosest known occasion: {matched[0]}" if matched else ""
        raw = llm.generate_structured(self.prompts.get("plan_decompose").text, f"Shopper language: {language}\nAllowed categories: {categories}{hint}\nMax needs: {max_needs}\n\nShopper situation: {text}", DECOMPOSE_SCHEMA, "plan_decompose_v1")
        allowed = set(categories)
        needs = []
        for i, need in enumerate((raw.get("needs") or [])[:max_needs], start=1):
            query = str(need.get("query") or "").strip()
            if not query:
                continue
            cats = [c for c in need.get("categories") or [] if not allowed or c in allowed]
            needs.append(Need(f"n{i}", str(need.get("label") or query)[:60], query, cats, need.get("priority") if need.get("priority") in PRIORITY_WEIGHT else "must"))
        if not needs:
            raise InvalidLLMOutput("decomposition returned no needs")
        budget = raw.get("budget") if isinstance(raw.get("budget"), (int, float)) and raw.get("budget") > 0 else None
        return {"id": matched[0] if matched else "llm", "label": str(raw.get("occasion") or "")}, needs, "llm", budget

    # --- retrieval -----------------------------------------------------------------------------

    def _retrieve(self, need: Need, text: str) -> None:
        with trace_step("retrieve", impl="search", id=need.id, params={"query": need.query, "categories": need.categories}) as step:
            results = []
            if need.categories:
                results = self._search(need.query, {"category": need.categories})
                if not results:
                    step.note("no product in the planned categories: category filter relaxed")
            if not results:
                results = self._search(need.query, {})
            overlay = {}
            if self.commerce is not None:
                try:
                    overlay = self.commerce.get_many([r.product_id for r in results]) or {}
                except Exception:
                    overlay = {}
            top = max((r.score for r in results), default=0.0) or 1.0
            need.candidates = []
            for result in results[: self.candidates_per_need]:
                extra = overlay.get(result.product_id) or {}
                stock = extra.get("stock") or {}
                metadata = result.metadata or {}
                need.candidates.append({"product_id": result.product_id, "title": result.title, "brand": metadata.get("brand"), "category": metadata.get("category"), "image_url": metadata.get("image_url"), "price": extra.get("price"), "in_stock": stock.get("in_stock") if stock else None, "score": round(float(result.score), 6), "rank": result.rank, "relevance": round(max(0.0, float(result.score)) / top, 4), "_evidence": {"content": metadata.get("search_text") or result.title, "attributes": metadata.get("attributes") or {}}})
            step.set_items([{"id": c["product_id"], "rank": c["rank"], "score": c["score"], "title": c["title"], "details": {"price": (c.get("price") or {}).get("amount"), "in_stock": c.get("in_stock")}} for c in need.candidates], total=len(results))
            step.set_summary(f"“{need.label}”: {len(need.candidates)} candidates")

    def _search(self, query: str, filters: dict[str, Any]) -> list[Any]:
        try:
            return self.search.search_text(SearchRequest(query=query, mode=SearchMode.HYBRID, top_k=self.candidates_per_need, candidate_k=max(50, self.candidates_per_need), filters=filters, pipeline=self.default_pipeline))
        except Exception:
            if filters:
                return []
            raise

    # --- evidence + justification ---------------------------------------------------------------

    def _evidence(self, needs: list[Need], chosen: dict[str, Any], text: str, language: str) -> tuple[list[RetrievedDocument], list[RetrievedDocument]]:
        documents = []
        for need in needs:
            item = chosen[need.id]
            if not item:
                continue
            evidence = item.get("_evidence") or {}
            documents.append(RetrievedDocument(f"product:{item['product_id']}", str(evidence.get("content") or item["title"]), item["score"], "product", {"title": item["title"], "product_id": item["product_id"], "brand": item.get("brand"), "category": item.get("category"), "image_url": item.get("image_url"), "attributes": evidence.get("attributes") or {}}))
        policies: list[RetrievedDocument] = []
        retrievers = getattr(getattr(self.rag, "multi_source", None), "retrievers", {}) or {}
        policy = retrievers.get("policy")
        if policy is not None:
            for query in _POLICY_QUERIES.get(language, _POLICY_QUERIES["en"]):
                try:
                    hits = [doc for doc in policy.retrieve(query, 3) if doc.id not in {p.id for p in policies}]
                except Exception:
                    hits = []
                policies.extend(hits[:1])
        for item in chosen.values():
            if item:
                item.pop("_evidence", None)
        for need in needs:
            for candidate in need.candidates:
                candidate.pop("_evidence", None)
                candidate.pop("relevance", None)
        return documents, policies

    def _justify_llm(self, llm, text, language, needs, chosen, budget, total, context) -> dict[str, Any] | None:
        prompt = self.prompts.get("plan_justify")
        plan_lines = [{"need_id": need.id, "need": need.label, "priority": need.priority, "product_id": (chosen[need.id] or {}).get("product_id"), "price_usd_synthetic": ((chosen[need.id] or {}).get("price") or {}).get("amount")} for need in needs]
        user = f"Shopper situation: {text}\nLanguage: {language}\nBudget (USD): {budget}\nPlanned total (USD, synthetic): {total}\nPlan: {plan_lines}\n\nEvidence (JSON lines):\n{context.rendered_context}\n\nAllowed citation IDs: {list(context.citation_ids)}"
        allowed = set(context.citation_ids)
        feedback = ""
        for attempt in (1, 2):
            with trace_step("generate", impl=getattr(llm, "provider_name", "llm"), id=f"generate_{attempt}") as step:
                step.set_details(model=getattr(llm, "model", None), prompt_id=prompt.id, prompt_version=prompt.version, attempt=attempt)
                try:
                    raw = llm.generate_structured(prompt.text + feedback, user, JUSTIFY_SCHEMA, "plan_justify_v1")
                except (LLMProviderError, InvalidLLMOutput) as exc:
                    step.set_summary(f"generation failed: {type(exc).__name__}")
                    return None
                step.set_details(raw_output=raw)
            with trace_step("validate_citations", impl="context_ids", id=f"validate_{attempt}") as step:
                try:
                    validated = self._validate_justification(raw, allowed, {need.id for need in needs if chosen[need.id]})
                except CitationValidationError as exc:
                    feedback = f" Your previous output was rejected: {exc}"
                    step.status = "rejected"
                    step.set_summary(f"attempt {attempt} rejected: {exc}")
                    continue
                step.set_summary(f"attempt {attempt} valid")
                return {**validated, "method": "llm"}
        return None

    @staticmethod
    def _validate_justification(raw: Any, allowed: set[str], planned: set[str]) -> dict[str, Any]:
        if not isinstance(raw, dict) or not isinstance(raw.get("summary"), str) or not raw["summary"].strip():
            raise CitationValidationError("missing summary")
        items = []
        for item in raw.get("items") or []:
            ids = [str(cid) for cid in item.get("citation_ids") or []]
            if item.get("need_id") not in planned:
                continue
            if not ids or any(cid not in allowed for cid in ids):
                raise CitationValidationError(f"reason for {item.get('need_id')} must cite supplied evidence only")
            items.append({"need_id": item["need_id"], "reason": str(item.get("reason") or "").strip(), "citation_ids": list(dict.fromkeys(ids))})
        tips = []
        for tip in raw.get("tips") or []:
            ids = [str(cid) for cid in tip.get("citation_ids") or []]
            if not ids or any(cid not in allowed for cid in ids):
                raise CitationValidationError("tips must cite supplied policy evidence")
            tips.append({"text": str(tip.get("text") or "").strip(), "citation_ids": list(dict.fromkeys(ids))})
        return {"summary": raw["summary"].strip(), "items": items, "tips": tips[:2], "insufficient_evidence": bool(raw.get("insufficient_evidence"))}

    def _justify_rules(self, language, occasion, needs, chosen, budget, total, documents, policy_docs) -> dict[str, Any]:
        vi = language == "vi"
        facts = {document.metadata.get("product_id"): document.metadata.get("attributes") or {} for document in documents}
        items = []
        for need in needs:
            item = chosen[need.id]
            if not item:
                continue
            attributes = {str(key).casefold(): value for key, value in facts.get(item["product_id"], {}).items()}
            parts = [f"{item['title']} — " + (f"khớp nhu cầu “{need.label}”, xếp hạng #{item['rank']} khi tìm “{need.query.strip()}”" if vi else f"matches “{need.label}”, ranked #{item['rank']} for “{need.query.strip()}”")]
            if item.get("brand"):
                parts.append(("thương hiệu " if vi else "brand ") + str(item["brand"]))
            for key in ("color", "material"):
                if attributes.get(key):
                    parts.append(f"{key}: {attributes[key]}")
            if item.get("price"):
                parts.append((f"giá {item['price']['amount']:.2f} USD (tổng hợp)" if vi else f"{item['price']['amount']:.2f} USD (synthetic)"))
            items.append({"need_id": need.id, "reason": "; ".join(parts) + ".", "citation_ids": [f"product:{item['product_id']}"]})
        tips = []
        for document in policy_docs[:2]:
            sentence = re.split(r"(?<=[.!?])\s+", " ".join(document.content.split()))[0][:220]
            tips.append({"text": sentence + (" (chính sách thử nghiệm)" if vi else " (experimental policy)"), "citation_ids": [document.id]})
        filled = sum(1 for item in chosen.values() if item)
        label = (occasion or {}).get("label") or ""
        skipped = [need.label for need in needs if not chosen[need.id] and need.candidates]
        if vi:
            summary = f"Kế hoạch “{label}”: chọn được {filled}/{len(needs)} món, tổng {total:.2f} USD" + (f" trong ngân sách {budget:.0f} USD" if budget is not None and total <= budget else (f", vượt ngân sách {budget:.0f} USD" if budget is not None else "")) + "."
            if skipped:
                summary += " Tạm bỏ qua để vừa ngân sách: " + ", ".join(skipped) + "."
            summary += " Giá là dữ liệu tổng hợp để minh hoạ."
        else:
            summary = f"Plan “{label}”: {filled}/{len(needs)} items, total {total:.2f} USD" + (f" within the {budget:.0f} USD budget" if budget is not None and total <= budget else "") + "."
            if skipped:
                summary += " Skipped to stay within budget: " + ", ".join(skipped) + "."
            summary += " Prices are synthetic demo data."
        return {"summary": summary, "items": items, "tips": tips, "insufficient_evidence": filled == 0, "method": "rules"}

    @staticmethod
    def _status_reason(status: str, language: str) -> str:
        vi = language == "vi"
        if status == "skipped_budget":
            return "Tạm bỏ qua để vừa ngân sách; xem các lựa chọn thay thế." if vi else "Skipped to stay within budget; see alternatives."
        if status == "no_match":
            return "Cửa hàng chưa có sản phẩm phù hợp cho nhu cầu này." if vi else "The store has no matching product for this need."
        return ""
