"""F3: compare 2-3 products with citations.

The attribute table comes straight from catalog data (no LLM, missing → ``None`` → "Không có dữ
liệu"). The narrative is RAG: evidence = one document per product (its catalog facts) + matching
reviews + relevant policies, budgeted by the same ``ContextBuilder``; the LLM must cite evidence IDs
for every point and citations are validated against the exact context (one retry with feedback).
"""
from __future__ import annotations

import json
from typing import Any

from shopmind.application.rag.citations import CitationResolver, CitationValidationError
from shopmind.core.tracing import trace_step
from shopmind.domain.search_result import RetrievedDocument
from shopmind.infrastructure.llm.base import InvalidLLMOutput

_SKIP_ATTRIBUTES = {"product_type"}
_POLICY_QUERY = {"vi": "chính sách đổi trả bảo hành giao hàng", "en": "return policy warranty shipping"}

COMPARE_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "points": {"type": "array", "items": {"type": "object", "properties": {"text": {"type": "string"}, "citation_ids": {"type": "array", "items": {"type": "string"}}}, "required": ["text", "citation_ids"], "additionalProperties": False}},
        "insufficient_evidence": {"type": "boolean"},
    },
    "required": ["summary", "points", "insufficient_evidence"],
    "additionalProperties": False,
}


class CompareError(ValueError):
    """Invalid compare request (wrong number of products)."""


def _product_document(product: dict[str, Any]) -> RetrievedDocument:
    lines = [product["title"]]
    for label, key in (("Brand", "brand"), ("Category", "category_label")):
        if product.get(key):
            lines.append(f"{label}: {product[key]}")
    lines += [f"{key}: {value}" for key, value in sorted((product.get("attributes") or {}).items()) if key not in _SKIP_ATTRIBUTES]
    lines += [f"- {item}" for item in product.get("bullet_points") or []][:8]
    if product.get("description"):
        lines.append(product["description"][:1200])
    pid = product["product_id"]
    return RetrievedDocument(f"product:{pid}", "\n".join(lines), 1.0, "product", {"title": product["title"], "product_id": pid, "brand": product.get("brand"), "category": product.get("category"), "image_url": product.get("image_url")})


def attribute_table(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = [{"name": "brand", "values": {p["product_id"]: p.get("brand") for p in products}}, {"name": "category", "values": {p["product_id"]: p.get("category_label") or p.get("category") for p in products}}]
    keys = sorted({key for p in products for key in (p.get("attributes") or {}) if key not in _SKIP_ATTRIBUTES})
    for key in keys:
        rows.append({"name": key, "values": {p["product_id"]: (p.get("attributes") or {}).get(key) or None for p in products}})
    for extra in ("price", "stock"):
        if any(p.get(extra) for p in products):
            rows.append({"name": extra, "values": {p["product_id"]: _format_extra(extra, p.get(extra)) for p in products}})
    return rows


def _format_extra(name: str, value: Any) -> str | None:
    if not value:
        return None
    if name == "price":
        return f"{value.get('amount')} {value.get('currency', '')} (synthetic)".strip()
    return f"{'in stock' if value.get('in_stock') else 'out of stock'} ({value.get('quantity')}, synthetic)"


class CompareService:
    def __init__(self, catalog, rag_service, prompts, *, reviews_per_product: int = 3, policies: int = 3) -> None:
        self.catalog = catalog
        self.rag = rag_service
        self.prompts = prompts
        self.reviews_per_product = reviews_per_product
        self.policies = policies

    def compare(self, product_ids: list[str], question: str | None = None, *, language: str = "vi") -> dict[str, Any]:
        ids = list(dict.fromkeys(pid.strip() for pid in product_ids if pid and pid.strip()))
        if not 2 <= len(ids) <= 3:
            raise CompareError("compare needs 2 or 3 distinct product ids")
        with trace_step("multi_source_retrieve", impl="catalog+knowledge", id="evidence", params={"product_ids": ids}) as step:
            products = [self.catalog.get_product(pid) for pid in ids]
            documents = [_product_document(product) for product in products]
            documents += self._knowledge(products, question, language)
            step.set_items([{"id": d.id, "rank": i, "score": d.score, "title": d.metadata.get("title"), "details": {"source": d.source}} for i, d in enumerate(documents, 1)], total=len(documents))
            step.set_summary(f"{len(products)} products, {len(documents) - len(products)} review/policy documents")
        table = attribute_table(products)
        cards = [{key: product.get(key) for key in ("product_id", "title", "brand", "category", "image_url")} for product in products]
        with trace_step("build_context", impl="budgeted") as step:
            context = self.rag.context_builder.build(documents)
            step.set_details(documents=[{"id": d.id, "source": d.source, "chars": len(d.content), "included": d.id in context.citation_ids} for d in documents], rendered_chars=context.metadata.get("context_characters"), budget=self.rag.context_builder.max_characters)
            step.set_summary(f"{len(context.citation_ids)} documents in context")
        llm = self.rag.llm
        if llm is None or not hasattr(llm, "generate_structured"):
            return {"products": cards, "attributes": table, "summary": None, "points": [], "sources": [], "insufficient_evidence": True, "llm_available": False}
        prompt = self.prompts.get("compare")
        user = f"Question: {question or ('So sánh các sản phẩm này.' if language == 'vi' else 'Compare these products.')}\n\nProducts: {json.dumps(ids)}\n\nEvidence (JSON lines):\n{context.rendered_context}\n\nAllowed citation IDs: {list(context.citation_ids)}"
        feedback = ""
        allowed = set(context.citation_ids)
        for attempt in (1, 2):
            with trace_step("generate", impl=getattr(llm, "provider_name", "llm"), id=f"generate_{attempt}") as step:
                step.set_details(model=getattr(llm, "model", None), prompt_id=prompt.id, prompt_version=prompt.version, attempt=attempt)
                raw = llm.generate_structured(prompt.text + (f" Your previous output was rejected: {feedback}" if feedback else ""), user, COMPARE_SCHEMA, "product_compare_v1")
                step.set_details(raw_output=raw)
            with trace_step("validate_citations", impl="context_ids", id=f"validate_{attempt}") as step:
                try:
                    points = self._validate(raw, allowed)
                except (CitationValidationError, InvalidLLMOutput) as exc:
                    feedback = str(exc)
                    step.status = "rejected"
                    step.set_summary(f"attempt {attempt} rejected: {exc}")
                    continue
                step.set_summary(f"attempt {attempt} valid: {len(points)} cited points")
            cited = tuple(dict.fromkeys(cid for point in points for cid in point["citation_ids"]))
            sources = CitationResolver().resolve(cited, context.documents)
            from shopmind.application.chat.service import citation_payload

            return {"products": cards, "attributes": table, "summary": raw["summary"], "points": points, "sources": [citation_payload(source) for source in sources], "insufficient_evidence": bool(raw.get("insufficient_evidence")), "llm_available": True}
        from shopmind.application.rag.service import RAGGenerationError

        raise RAGGenerationError("comparison output failed citation validation twice")

    @staticmethod
    def _validate(raw: Any, allowed: set[str]) -> list[dict[str, Any]]:
        if not isinstance(raw, dict) or not isinstance(raw.get("summary"), str) or not isinstance(raw.get("points"), list):
            raise InvalidLLMOutput("comparison output has an invalid shape")
        points = []
        for point in raw["points"]:
            ids = [str(cid) for cid in point.get("citation_ids") or []]
            if not str(point.get("text") or "").strip():
                continue
            if not ids:
                raise CitationValidationError("every comparison point needs at least one citation")
            outside = [cid for cid in ids if cid not in allowed]
            if outside:
                raise CitationValidationError(f"citation outside the supplied evidence: {outside[0]}")
            points.append({"text": str(point["text"]).strip(), "citation_ids": list(dict.fromkeys(ids))})
        return points

    def _knowledge(self, products: list[dict[str, Any]], question: str | None, language: str) -> list[RetrievedDocument]:
        retrievers = getattr(getattr(self.rag, "multi_source", None), "retrievers", {}) or {}
        documents: list[RetrievedDocument] = []
        review = retrievers.get("review")
        if review is not None:
            for product in products:
                try:
                    documents += review.retrieve(question or product["title"], self.reviews_per_product, product_id=product["product_id"])[: self.reviews_per_product]
                except Exception:
                    continue  # reviews are optional evidence (index may be absent)
        policy = retrievers.get("policy")
        if policy is not None:
            try:
                documents += policy.retrieve(question or _POLICY_QUERY.get(language, _POLICY_QUERY["en"]), self.policies)[: self.policies]
            except Exception:
                pass
        return documents
