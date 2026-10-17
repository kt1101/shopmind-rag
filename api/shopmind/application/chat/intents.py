"""F2: one-step intent routing and query understanding for the shopping assistant.

Rules first (deterministic, free, explainable in the trace); an LLM extractor can replace the
rules when ``features.query_understanding: llm`` and a provider with ``understand_query`` exists.
Extracted filter values are only ever values that exist in the catalog (resolved through the
repository's filter options), never free LLM text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from shopmind.application.retrieval.language import explain_lexical_query, known_colors

INTENTS = ("product_search", "product_question", "policy_question", "compare", "chitchat", "shopping_plan")

_CHITCHAT = re.compile(r"^\s*(xin chào|chào( bạn| shop)?|hello|hi|hey|cảm ơn|cám ơn|thanks?( you)?|ok(ay)?|tạm biệt|bye)\b[\s!.?]*$", re.IGNORECASE)
# A situation to shop for (several products, often with a budget) → the shopping planner (F6).
_PLAN = re.compile(r"(lên kế hoạch|lên danh sách|chuẩn bị (cho|đi|đồ)|mới chuyển|chuyển (vào|sang|đến)?\s*nhà|dọn (vào|về) nhà|nhà mới|căn hộ mới|đi (biển|du lịch|cắm trại|công tác)|góc làm việc|làm việc tại nhà|quà (tặng|sinh nhật|cho)|mua quà|setting up|set up my|moving (in|into)|new apartment|planning (a|my|for)|prepare for|packing for|home office|gift (for|ideas))", re.IGNORECASE)
_BUDGET_WORD = re.compile(r"(ngân sách|budget)", re.IGNORECASE)
_COMPARE = re.compile(r"(so sánh|compare|\bvs\.?\b|khác nhau|difference between|nên chọn cái nào|which (one|is better))", re.IGNORECASE)
_POLICY = re.compile(r"(đổi trả|trả hàng|hoàn tiền|bảo hành|giao hàng|vận chuyển|phí ship|thanh toán|chính sách|return|refund|warranty|shipping|delivery|payment|policy|exchange)", re.IGNORECASE)
_SEARCH = re.compile(r"^\s*(tìm|kiếm|cho (tôi|mình) xem|gợi ý|mình cần mua|tôi cần mua|muốn mua|có .* nào|find|search|show me|looking for|recommend|i need|i want( to buy)?)\b", re.IGNORECASE)
_PRICE_MAX = re.compile(r"(dưới|không quá|tối đa|under|below|less than|max(imum)?)\s*\$?\s*(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|đô|usd|\$|dollars?)?", re.IGNORECASE)
_PRICE_MIN = re.compile(r"(trên|từ|ít nhất|over|above|more than|at least|min(imum)?)\s*\$?\s*(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|đô|usd|\$|dollars?)?", re.IGNORECASE)


@dataclass
class Understanding:
    intent: str
    method: str
    reason: str
    query: str
    rewritten_query: str
    filters: dict[str, list[str]] = field(default_factory=dict)
    price: dict[str, float] = field(default_factory=dict)
    spans: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"intent": self.intent, "method": self.method, "reason": self.reason, "query": self.query, "rewritten_query": self.rewritten_query, "filters": self.filters, "price": self.price, "spans": self.spans}


def route_intent(message: str, *, has_image: bool = False, product_id: str | None = None) -> tuple[str, str]:
    if has_image:
        return "product_search", "an image is attached"
    if _CHITCHAT.match(message):
        return "chitchat", "greeting / thanks"
    if _PLAN.search(message) or (_BUDGET_WORD.search(message) and re.search(r",|và|and", message)):
        return "shopping_plan", "a situation to shop for: plan a basket"
    if _COMPARE.search(message):
        return "compare", "comparison wording"
    if _POLICY.search(message):
        return "policy_question", "store-policy wording (returns, shipping, warranty…)"
    if _SEARCH.search(message) and not product_id:
        return "product_search", "search request wording"
    if product_id:
        return "product_question", "question while viewing a product"
    if len(message.split()) <= 6 and "?" not in message:
        return "product_search", "short keyword-style message"
    return "product_question", "open question: answer with RAG"


def _price(match: re.Match[str] | None) -> float | None:
    if match is None:
        return None
    value = float(match.group(3).replace(",", "."))
    unit = (match.group(4) or "").casefold()
    return value * 1000 if unit in {"k", "nghìn", "ngàn"} else value


class RuleQueryUnderstanding:
    """Extract brand / category / color filters from a sentence using the catalog + vocabulary."""

    method = "rules"

    def __init__(self, catalog_values=None) -> None:
        # catalog_values(field) -> every catalog value of brand / category (cached by the caller)
        self.catalog_values = catalog_values

    def _catalog_values(self, field_name: str) -> list[str]:
        if self.catalog_values is None:
            return []
        try:
            return list(self.catalog_values(field_name))
        except Exception:
            return []

    def understand(self, message: str, *, has_image: bool = False, product_id: str | None = None) -> Understanding:
        intent, reason = route_intent(message, has_image=has_image, product_id=product_id)
        normalized, aliases = explain_lexical_query(message)
        filters: dict[str, list[str]] = {}
        spans: list[dict[str, str]] = []
        remaining = normalized
        categories = {value.casefold(): value for value in self._catalog_values("category")}
        for alias in aliases:
            if alias["kind"] == "category" and alias["to"].casefold() in categories:
                filters.setdefault("category", []).append(categories[alias["to"].casefold()])
                spans.append({"text": alias["from"], "filter": "category", "value": categories[alias["to"].casefold()]})
        colors = known_colors()
        for spelling, canonical in sorted(colors.items(), key=lambda item: -len(item[0])):
            if re.search(rf"(?<!\w){re.escape(spelling)}(?!\w)", message, re.IGNORECASE) and canonical not in filters.get("color", []):
                filters.setdefault("color", []).append(canonical)
                spans.append({"text": spelling, "filter": "color", "value": canonical})
        for brand in self._catalog_values("brand"):
            if len(brand) >= 3 and re.search(rf"(?<!\w){re.escape(brand)}(?!\w)", message, re.IGNORECASE):
                filters.setdefault("brand", []).append(brand)
                spans.append({"text": brand, "filter": "brand", "value": brand})
                remaining = re.sub(rf"(?<!\w){re.escape(brand)}(?!\w)", " ", remaining, flags=re.IGNORECASE)
        price = {key: value for key, value in (("max", _price(_PRICE_MAX.search(message))), ("min", _price(_PRICE_MIN.search(message)))) if value is not None}
        for pattern in (_PRICE_MAX, _PRICE_MIN):
            remaining = pattern.sub(" ", remaining)
        remaining = re.sub(r"^\s*(tìm|kiếm|find|search|show me|looking for)\s+", "", remaining, flags=re.IGNORECASE)
        rewritten = " ".join(remaining.split()) or message
        return Understanding(intent, self.method, reason, message, rewritten, filters, price, spans)


class LLMQueryUnderstanding(RuleQueryUnderstanding):
    """Structured-output LLM extractor constrained to catalog values; falls back to rules."""

    method = "llm"

    def __init__(self, llm, prompt: str, catalog_values=None) -> None:
        super().__init__(catalog_values)
        self.llm = llm
        self.prompt = prompt

    def understand(self, message: str, *, has_image: bool = False, product_id: str | None = None) -> Understanding:
        rules = super().understand(message, has_image=has_image, product_id=product_id)
        extract = getattr(self.llm, "understand_query", None)
        if extract is None:
            return rules
        allowed = {name: self._catalog_values(name) for name in ("brand", "category")}
        allowed["color"] = sorted(set(known_colors().values()))
        try:
            raw = extract(message, allowed, self.prompt)
        except Exception:
            rules.reason += " (LLM unavailable: rules used)"
            return rules
        filters = {name: [value for value in (raw.get("filters", {}).get(name) or []) if value in allowed[name]] for name in allowed}
        filters = {name: values for name, values in filters.items() if values}
        intent = raw.get("intent") if raw.get("intent") in INTENTS else rules.intent
        price = {key: float(raw[f"price_{key}"]) for key in ("max", "min") if isinstance(raw.get(f"price_{key}"), (int, float))}
        return Understanding(intent, "llm", "LLM structured extraction (catalog-constrained)", message, str(raw.get("rewritten_query") or rules.rewritten_query), filters, price, [{"text": value, "filter": name, "value": value} for name, values in filters.items() for value in values])
