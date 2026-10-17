"""A1 search pipeline steps (registered as ``step.<impl>``, composed in ``configs/pipelines/search.yaml``).

Every step reads/writes the shared ``PipelineContext`` and describes itself in its ``StepTrace``:

    ctx.request              SearchRequest (query, filters, top_k, candidate_k, mode)
    ctx.state["image"]       PIL image for image / compose pipelines
    ctx.state["alpha"]       compose image weight override
    ctx.rankings[<step id>]  candidate list of each retrieve step (fused in declaration order)
    ctx.results              current ranked list (final list after the last step)

Components come from the services container: ``repository`` (Elasticsearch product repository),
``embedders`` (id → embedder) and ``field_embedders`` (vector field → embedder id).
"""
from __future__ import annotations

import re
from dataclasses import replace
from typing import Any

import numpy as np

from shopmind.application.pipeline.engine import PipelineContext, register_condition, register_step
from shopmind.application.retrieval.fusion import fuse_named_rankings
from shopmind.application.retrieval.language import detect_language, explain_lexical_query, known_colors
from shopmind.application.retrieval.reranker import AttributeBoostReranker, CrossEncoderReranker
from shopmind.core.config import StepSpec
from shopmind.core.tracing import StepTrace, result_items
from shopmind.domain.search_result import RawSearchHit, RetrievalScores, SearchResult
from shopmind.infrastructure.embedding.factory import embed_query
from shopmind.infrastructure.embedding.validation import validate_vectors

_IDENTIFIER = re.compile(r"^\s*[A-Z0-9]{8,12}\s*$", re.IGNORECASE)
_MODEL_TOKEN = re.compile(r"\b[a-z]*\d+[a-z0-9-]*\b", re.IGNORECASE)


def adaptive_search_mode(query: str) -> tuple[str, str]:
    """Rule router for ``mode=adaptive``: identifier → bm25, descriptive → dense, mixed → hybrid."""
    if _IDENTIFIER.match(query) and any(char.isdigit() for char in query):
        return "bm25", "query looks like a product identifier"
    tokens = query.split()
    model_tokens = _MODEL_TOKEN.findall(query)
    if model_tokens and len(tokens) <= len(model_tokens) + 1:
        return "bm25", f"model/size token(s) {model_tokens} dominate the query"
    if model_tokens:
        return "hybrid", f"descriptive words plus model/size token(s) {model_tokens}"
    if len(tokens) <= 2:
        return "hybrid", "short keyword query: combine exact and semantic matching"
    return "dense", "descriptive natural-language query"


@register_condition("needs_lexical")
def _needs_lexical(ctx: PipelineContext) -> bool:
    return ctx.state.get("adaptive_mode") in (None, "bm25", "hybrid")


@register_condition("needs_dense")
def _needs_dense(ctx: PipelineContext) -> bool:
    return bool(ctx.request.query) and ctx.state.get("adaptive_mode") in (None, "dense", "hybrid")


@register_condition("has_text")
def _has_text(ctx: PipelineContext) -> bool:
    return bool(ctx.request.query)


def _hits_to_results(hits: list[RawSearchHit], *, source: str, lexical: bool) -> list[SearchResult]:
    return [SearchResult(product_id=hit.product_id, title=hit.title, rank=rank, score=hit.score, source=source, metadata=dict(hit.metadata), retrieval_scores=RetrievalScores(bm25_rank=rank) if lexical else RetrievalScores(dense_rank=rank)) for rank, hit in enumerate(hits, start=1)]


def _candidate_k(spec: StepSpec, ctx: PipelineContext) -> int:
    return int(spec.params.get("candidate_k") or ctx.request.candidate_k)


def _set_ranking(ctx: PipelineContext, spec: StepSpec, results: list[SearchResult], trace: StepTrace) -> None:
    ctx.rankings[spec.key] = results
    ctx.results = results
    trace.set_items(result_items(results), total=len(results))


# --- query understanding ------------------------------------------------------------------------

@register_step("query_understanding", "rules")
def query_understanding_rules(spec: StepSpec, services: Any):
    """Language, alias normalization (vocabulary YAML), adaptive routing and filter resolution."""
    adaptive = bool(spec.params.get("adaptive", False))

    def run(ctx: PipelineContext, trace: StepTrace) -> None:
        request = ctx.request
        details: dict[str, Any] = {}
        if request.query:
            normalized, aliases = explain_lexical_query(request.query)
            language = detect_language(request.query)
            ctx.state.update(language=language, normalized_query=normalized)
            details.update(language=language, normalized_query=normalized, aliases=aliases)
            for alias in aliases:
                trace.note(f"alias '{alias['from']}' -> {alias['kind']} '{alias['to']}'")
            if adaptive:
                mode, reason = adaptive_search_mode(request.query)
                ctx.state["adaptive_mode"] = mode
                details["adaptive"] = {"mode": mode, "reason": reason}
                trace.note(f"adaptive chose {mode}: {reason}")
        repository = services.get("repository") if services is not None else None
        if request.filters and trace.verbose and hasattr(repository, "describe_filters"):
            try:
                details["filters"] = repository.describe_filters(request.filters)
            except Exception:  # the inspector must never break search
                trace.note("filter resolution details unavailable")
        trace.set_details(**details)
        trace.set_summary(f"{details.get('language', 'no query')}; {len(details.get('aliases', []))} alias(es)" + (f"; adaptive → {ctx.state['adaptive_mode']}" if adaptive and request.query else ""))

    return run


# --- retrieval -----------------------------------------------------------------------------------

@register_step("retrieve", "bm25")
def retrieve_bm25(spec: StepSpec, services: Any):
    def run(ctx: PipelineContext, trace: StepTrace) -> None:
        repository = services.get("repository")
        request = ctx.request
        if request.query and hasattr(repository, "exact_id_search"):
            exact = repository.exact_id_search(request.query, request.filters)
            if exact:
                results = [replace(result, metadata={**result.metadata, "ordering_policy": "exact_id"}) for result in _hits_to_results(exact, source="bm25", lexical=True)]
                _set_ranking(ctx, spec, results, trace)
                trace.set_summary("exact product id match: later steps skipped")
                ctx.stop()
                return
        debug: dict[str, Any] | None = {} if trace.verbose else None
        kwargs = {"debug": debug} if debug is not None else {}
        hits = repository.lexical_search(request.query, size=_candidate_k(spec, ctx), filters=request.filters, **kwargs)
        results = _hits_to_results(hits, source="bm25", lexical=True)
        _set_ranking(ctx, spec, results, trace)
        if debug:
            trace.set_details(query_dsl=debug.get("query_dsl"))
        trace.set_summary(f"{len(results)} candidates from BM25" + (" (filter-only, sorted by id)" if not request.query else ""))

    return run


def _embedder_for(services: Any, spec: StepSpec, field: str) -> tuple[str, Any]:
    embedder_id = spec.params.get("embedder") or (services.get("field_embedders") or {}).get(field)
    embedders = services.get("embedders") or {}
    if embedder_id not in embedders:
        raise LookupError(f"no embedder configured for {field} ({embedder_id!r})")
    return embedder_id, embedders[embedder_id]


def _query_vector(ctx: PipelineContext, spec: StepSpec, embedder: Any, source: str) -> np.ndarray:
    if source == "composed":
        vector = ctx.state["query_vector"]
    elif source == "image":
        vector = embedder.embed_images([ctx.state["image"]])[0]
    else:
        vector = embed_query(embedder, ctx.request.query)[0]
    vector = np.asarray(vector, dtype=np.float32)
    validate_vectors(vector[None, :], int(vector.shape[0]))
    return vector


@register_step("retrieve", "dense")
def retrieve_dense(spec: StepSpec, services: Any):
    """kNN on a vector field. ``input``: ``text`` (query encoder of the embedder), ``image`` or
    ``composed`` (vector from ``compose_query``). ``field`` defaults to ``text_vector``."""
    field = spec.params.get("field", "text_vector")
    source_input = spec.params.get("input", "text")
    label = spec.params.get("source") or {"image": "image_dense", "composed": "compose"}.get(source_input) or ("cross_modal" if field == "image_vector" else "dense_siglip" if field == "siglip_text_vector" else "dense")

    def run(ctx: PipelineContext, trace: StepTrace) -> None:
        repository = services.get("repository")
        embedder_id, embedder = _embedder_for(services, spec, field)
        vector = _query_vector(ctx, spec, embedder, source_input)
        size = _candidate_k(spec, ctx)
        debug: dict[str, Any] | None = {} if trace.verbose else None
        kwargs: dict[str, Any] = {"debug": debug} if debug is not None else {}
        if ctx.state.get("exclude_ids"):
            kwargs["exclude_ids"] = list(ctx.state["exclude_ids"])
        hits = repository.vector_search(field, vector.tolist(), size=size, num_candidates=max(size, int(spec.params.get("num_candidates", size))), filters=ctx.request.filters, **kwargs)
        results = _hits_to_results(hits, source=label, lexical=False)
        _set_ranking(ctx, spec, results, trace)
        trace.set_details(field=field, embedder=embedder_id, input=source_input, query_vector={"dims": [int(vector.shape[0])], "norm": round(float(np.linalg.norm(vector)), 4)}, **({"query_dsl": debug.get("query_dsl")} if debug else {}))
        trace.set_summary(f"{len(results)} nearest neighbours on {field} ({embedder_id}, {source_input} query)")

    return run


# --- fusion --------------------------------------------------------------------------------------

def _fuse_step(method: str):
    def factory(spec: StepSpec, services: Any):
        params = spec.params
        k = int(params.get("k", 60))
        weights = params.get("weights")
        lexical_preserving = bool(params.get("lexical_preserving", False))
        lexical_id = params.get("lexical", "lexical")

        def run(ctx: PipelineContext, trace: StepTrace) -> None:
            rankings = {name: ranking for name, ranking in ctx.rankings.items() if ranking is not None}
            top_k = int(params.get("top_k") or ctx.request.candidate_k)
            if len(rankings) < 2:
                only = next(iter(rankings.values()), [])
                ctx.results = only
                trace.set_items(result_items(only), total=len(only))
                trace.set_summary("single ranking: nothing to fuse")
                return
            fused = fuse_named_rankings(rankings, method=method, k=k, weights=weights, top_k=top_k * (2 if lexical_preserving else 1))
            if lexical_preserving and lexical_id in rankings:
                by_id = {result.product_id: result for result in fused}
                lexical_ids = [result.product_id for result in rankings[lexical_id]]
                ordered = [by_id[pid] for pid in lexical_ids if pid in by_id] + [result for result in fused if result.product_id not in set(lexical_ids)]
                fused = [replace(result, rank=rank, metadata={**result.metadata, "ordering_policy": "lexical_preserving"}) for rank, result in enumerate(ordered[:top_k], start=1)]
                trace.note("lexical_preserving: BM25 order kept, fused-only candidates appended")
            ctx.results = fused
            trace.set_items(result_items(fused), total=len(fused))
            weight_text = f" weights={weights}" if weights else ""
            trace.set_summary(f"{method.upper()} over {', '.join(f'{name}({len(r)})' for name, r in rankings.items())}{weight_text} → {len(fused)}")

        return run

    return factory


register_step("fuse", "rrf")(_fuse_step("rrf"))
register_step("fuse", "linear")(_fuse_step("linear"))


# --- reranking -----------------------------------------------------------------------------------

@register_step("rerank", "noop")
def rerank_noop(spec: StepSpec, services: Any):
    def run(ctx: PipelineContext, trace: StepTrace) -> None:
        trace.set_summary("order unchanged")

    return run


_CROSS_ENCODERS: dict[str, CrossEncoderReranker] = {}


@register_step("rerank", "cross_encoder")
def rerank_cross_encoder(spec: StepSpec, services: Any):
    model_name = spec.params.get("model")
    if not model_name:
        raise ValueError("rerank.cross_encoder requires params.model")
    depth = int(spec.params.get("depth", 50))

    def run(ctx: PipelineContext, trace: StepTrace) -> None:
        if not ctx.request.query or not ctx.results:
            trace.set_summary("skipped: no text query")
            return
        reranker = _CROSS_ENCODERS.setdefault(model_name, CrossEncoderReranker(model_name))
        head, tail = ctx.results[:depth], ctx.results[depth:]
        reranked = reranker.rerank(ctx.request.query, head, len(head))
        ctx.results = reranked + [replace(result, rank=len(reranked) + offset) for offset, result in enumerate(tail, start=1)]
        trace.set_items(result_items(reranked), total=len(reranked))
        trace.set_summary(f"cross-encoder reranked top {len(head)}")

    return run


@register_step("rerank", "attribute_boost")
def rerank_attribute_boost(spec: StepSpec, services: Any):
    """Boost candidates whose attributes match values named in the text (``màu đen`` → black)."""
    boost = float(spec.params.get("boost", 0.05))
    fields = list(spec.params.get("fields", ["color"]))

    def run(ctx: PipelineContext, trace: StepTrace) -> None:
        text = ctx.request.query or ""
        colors = known_colors()
        wanted: dict[str, set[str]] = {}
        if "color" in fields:
            found = {canonical for spelling, canonical in colors.items() if re.search(rf"(?<!\w){re.escape(spelling)}(?!\w)", text, re.IGNORECASE)}
            if found:
                wanted["color"] = found

        def normalize(field: str, value: str) -> str:
            value = value.strip().casefold()
            if field == "color":
                for token in [value, *re.split(r"[\s,/&+-]+", value)]:
                    if token in colors:
                        return colors[token]
            return value

        before = ctx.results
        ctx.results = AttributeBoostReranker(boost).rerank(before, wanted, len(before), normalize)
        trace.set_items(result_items(ctx.results), total=len(ctx.results))
        trace.set_details(wanted={key: sorted(values) for key, values in wanted.items()}, boost=boost)
        trace.set_summary(f"boosted {sum(1 for result in ctx.results if result.metadata.get('boosted'))} candidate(s) matching {dict((k, sorted(v)) for k, v in wanted.items())}" if wanted else "no attribute named in the text")

    return run


# --- composed image + text query (F1) -------------------------------------------------------------

@register_step("compose_query", "weighted_sum")
def compose_weighted_sum(spec: StepSpec, services: Any):
    """``q = normalize(α·e_image + (1−α)·e_text)`` in the shared SigLIP2 space."""
    default_alpha = spec.params.get("image_weight")
    field = spec.params.get("field", "image_vector")

    def run(ctx: PipelineContext, trace: StepTrace) -> None:
        _, embedder = _embedder_for(services, spec, field)
        alpha = ctx.state.get("alpha")
        if alpha is None:
            alpha = default_alpha if default_alpha is not None else 0.7
        alpha = min(1.0, max(0.0, float(alpha)))
        image_vector = np.asarray(embedder.embed_images([ctx.state["image"]])[0], dtype=np.float32)
        text_vector = np.asarray(embed_query(embedder, ctx.request.query)[0], dtype=np.float32) if ctx.request.query else np.zeros_like(image_vector)
        combined = alpha * image_vector + (1 - alpha) * text_vector
        norm = float(np.linalg.norm(combined))
        if norm <= 1e-12:
            combined, norm = image_vector, float(np.linalg.norm(image_vector))
        ctx.state["query_vector"] = combined / norm
        ctx.state["alpha"] = alpha
        cosine = float(np.dot(image_vector, text_vector)) if ctx.request.query else None
        trace.set_details(alpha=alpha, image_vector={"dims": [int(image_vector.shape[0])], "norm": round(float(np.linalg.norm(image_vector)), 4)}, text_vector={"dims": [int(text_vector.shape[0])], "norm": round(float(np.linalg.norm(text_vector)), 4)}, image_text_cosine=None if cosine is None else round(cosine, 4))
        trace.set_summary(f"q = normalize({alpha:.2f}·image + {1 - alpha:.2f}·text)")

    return run
