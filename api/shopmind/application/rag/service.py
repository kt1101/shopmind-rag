from __future__ import annotations

import threading
from collections.abc import Iterator
from time import perf_counter
from typing import TYPE_CHECKING, Any

from shopmind.core.tracing import current_trace, trace_step
from shopmind.infrastructure.llm.base import InvalidLLMOutput, LLMProviderError, LLMRequest
from shopmind.infrastructure.llm.prompts import PromptLibrary, default_prompts
from shopmind.application.knowledge.base import KnowledgeMode, resolve_knowledge_mode
from shopmind.application.rag.citations import CitationValidationError
from shopmind.application.rag.models import GenerationDelta, GenerationFinal, GenerationReset, PreparedContext, RAGAnswer, RAGRequest, SOURCES

if TYPE_CHECKING:
    from shopmind.core.config import RAGConfig


class RAGApplicationError(RuntimeError):
    pass


class KnowledgeRetrievalUnavailable(RAGApplicationError):
    pass


class RerankerUnavailable(RAGApplicationError):
    pass


class ContextConstructionError(RAGApplicationError):
    pass


class RAGGenerationError(RAGApplicationError):
    pass


def _doc_items(documents) -> list[dict[str, Any]]:
    return [{"id": document.id, "rank": rank, "score": round(float(document.score), 6), "title": document.metadata.get("title", document.id), "details": {"source": document.source, **({"pre_rerank_score": document.metadata["pre_rerank_score"]} if "pre_rerank_score" in document.metadata else {})}} for rank, document in enumerate(documents, start=1)]


class RAGService:
    """A3 multi-source RAG. Each stage records a glass-box step in the active trace:
    ``multi_source_retrieve`` → ``fuse`` → ``rerank`` → ``build_context`` → ``generate`` →
    ``validate_citations`` (one generate/validate pair per attempt)."""

    def __init__(self, multi_source, fusion, reranker, context_builder, llm, validator, resolver, max_generation_attempts: int = 2, *, rrf_k: int = 60, fused_top_k: int = 40, rerank_top_k: int = 12, prompts: PromptLibrary | None = None, fusion_name: str = "rrf") -> None:
        if max_generation_attempts not in (1, 2):
            raise ValueError("max_generation_attempts must be 1 or 2")
        self.multi_source = multi_source
        self.fusion = fusion
        self.reranker = reranker
        self.context_builder = context_builder
        self.llm = llm
        self.validator = validator
        self.resolver = resolver
        self.max_generation_attempts = max_generation_attempts
        self.rrf_k = rrf_k
        self.fused_top_k = fused_top_k
        self.rerank_top_k = rerank_top_k
        self.prompts = prompts or default_prompts()
        self.fusion_name = fusion_name

    def answer(self, request: RAGRequest) -> RAGAnswer:
        if self.llm is None:
            raise LLMProviderError("OPENAI_API_KEY is not configured")
        return self.generate(request, self.prepare(request))

    def prepare(self, request: RAGRequest) -> PreparedContext:
        started = perf_counter()
        reranked, trace = self._retrieve_ranked(request)
        with trace_step("build_context", impl="budgeted", params={"max_documents": self.context_builder.max_documents, "per_source": self.context_builder.source_limits, "max_characters": self.context_builder.max_characters}) as step:
            try:
                context = self.context_builder.build(reranked)
            except Exception as exc:
                raise ContextConstructionError("RAG context construction failed") from exc
            included = set(context.citation_ids)
            truncated = set(context.metadata.get("truncated_ids", []))
            documents = [{"id": document.id, "source": document.source, "chars": len(document.content), "included": document.id in included, "reason": ("truncated to fit the character budget" if document.id in truncated else "included") if document.id in included else "over the per-source / document / character budget"} for document in reranked]
            step.set_details(documents=documents, rendered_chars=context.metadata.get("context_characters"), budget=self.context_builder.max_characters, source_counts=context.metadata.get("source_counts"), rendered_context=context.rendered_context[:6000])
            step.set_summary(f"{len(included)} of {len(reranked)} documents sent ({context.metadata.get('context_characters')} chars)")
        trace = {**trace, "context_ids": list(context.citation_ids), **context.metadata, "missing_sources": [source for source in request.sources if not context.metadata["source_counts"].get(source)]}
        return PreparedContext(context, trace, started, current_trace())

    def generate(self, request: RAGRequest, prepared: PreparedContext) -> RAGAnswer:
        abstained = self._abstain(prepared)
        if abstained is not None:
            return abstained
        answer = self._generate(request, prepared.context, prepared.pipeline_trace)
        return self._finish(prepared, answer)

    def generate_stream(self, request: RAGRequest, prepared: PreparedContext, cancelled: threading.Event | None = None) -> Iterator[GenerationDelta | GenerationReset | GenerationFinal]:
        abstained = self._abstain(prepared)
        if abstained is not None:
            yield GenerationFinal(abstained)
            return
        context = prepared.context
        feedback = ""
        attempts: list[dict[str, Any]] = []
        for attempt in range(1, self.max_generation_attempts + 1):
            emitted = False
            llm_request = self._llm_request(request, context, feedback)
            try:
                with trace_step("generate", impl=self._llm_name(), id=f"generate_{attempt}", trace=prepared.pipeline_trace) as step:
                    self._describe_generation(step, llm_request, attempt)
                    response = None
                    for item in self.llm.generate_stream(llm_request, cancelled):
                        if isinstance(item, str):
                            emitted = True
                            yield GenerationDelta(item)
                            continue
                        response = item
                        break
                    if response is None:
                        step.set_summary("stream stopped before completion (cancelled)")
                        return  # the provider stopped early (cancelled): no final answer
                    self._record_response(step, response)
                answer = self._validate_traced(context, response, attempt, attempts, prepared.pipeline_trace)
                yield GenerationFinal(self._finish(prepared, answer))
                return
            except (InvalidLLMOutput, CitationValidationError) as exc:
                if cancelled is not None and cancelled.is_set():
                    return  # the client is gone: no reset, no retry, no error
                feedback = str(exc)
                if emitted and attempt < self.max_generation_attempts:
                    yield GenerationReset()
        raise RAGGenerationError("answer output failed validation")

    def _abstain(self, prepared: PreparedContext) -> RAGAnswer | None:
        if prepared.context.documents:
            return None
        with trace_step("generate", impl="abstain", trace=prepared.pipeline_trace) as step:
            step.set_summary("no evidence in the context: abstained without calling the LLM")
        return RAGAnswer("Insufficient evidence in the indexed knowledge sources.", (), True, {**prepared.trace, "generation_attempts": 0, "total_ms": (perf_counter() - prepared.started) * 1000})

    @staticmethod
    def _finish(prepared: PreparedContext, answer: RAGAnswer) -> RAGAnswer:
        return RAGAnswer(answer.answer, answer.sources, answer.insufficient_evidence, {**prepared.trace, **answer.metadata, "total_ms": (perf_counter() - prepared.started) * 1000})

    def retrieve(self, request: RAGRequest) -> dict:
        _, trace = self._retrieve_ranked(request)
        return trace

    def _retrieve_ranked(self, request: RAGRequest):
        with trace_step("multi_source_retrieve", impl="per_source", id="retrieve", params={"sources": list(request.sources), "product_id": request.product_id}) as step:
            try:
                rankings = self.multi_source.retrieve(request.question, request.sources, product_id=request.product_id)
                rankings = {
                    source: [document for document in documents if document.source == source and (
                        request.product_id is None or source == "policy" or (
                            document.metadata.get("product_id") == request.product_id
                            and (source != "product" or document.id == f"product:{request.product_id}")
                        )
                    )]
                    for source, documents in rankings.items() if source in request.sources
                }
            except Exception as exc:
                raise KnowledgeRetrievalUnavailable("knowledge retrieval is unavailable") from exc
            retrieval_modes = {}
            for source in rankings:
                mode = getattr(self.multi_source.retrievers[source], "mode", None)
                if mode is not None:
                    retrieval_modes[source] = "bm25" if source == "product" and request.product_id else resolve_knowledge_mode(KnowledgeMode(mode), request.question).value
            step.set_items([item for source in SOURCES for item in _doc_items(rankings.get(source, []))], total=sum(len(documents) for documents in rankings.values()))
            step.set_details(per_source={source: {"candidates": len(documents), "mode": retrieval_modes.get(source)} for source, documents in rankings.items()})
            step.set_summary(", ".join(f"{source}: {len(documents)}" for source, documents in rankings.items()) or "no sources")
        with trace_step("fuse", impl=self.fusion_name, params={"k": self.rrf_k, "top_k": self.fused_top_k}) as step:
            try:
                fused = self.fusion([rankings[source] for source in SOURCES if source in rankings], k=self.rrf_k, top_k=self.fused_top_k)
            except Exception as exc:
                raise KnowledgeRetrievalUnavailable("knowledge retrieval is unavailable") from exc
            step.set_items(_doc_items(fused), total=len(fused))
            step.set_summary(f"{len(fused)} documents after {self.fusion_name}")
        with trace_step("rerank", impl=getattr(self.reranker, "trace_name", type(self.reranker).__name__), params={"top_k": self.rerank_top_k}) as step:
            try:
                reranked = self.reranker.rerank(request.question, fused, self.rerank_top_k)
            except Exception as exc:
                raise RerankerUnavailable("document reranking is unavailable") from exc
            before = {document.id: rank for rank, document in enumerate(fused, start=1)}
            step.set_items([{**item, "details": {**item["details"], "before_rank": before.get(item["id"]), "after_rank": item["rank"]}} for item in _doc_items(reranked)], total=len(reranked))
            step.set_summary(f"kept {len(reranked)} of {len(fused)}")
        trace = {
            "per_source_candidate_counts": {source: len(documents) for source, documents in rankings.items()},
            "retrieval_modes": retrieval_modes,
            "retrieved_ids": [document.id for source in SOURCES for document in rankings.get(source, ())],
            "fused_ids": [document.id for document in fused],
            "reranked_ids": [document.id for document in reranked],
        }
        return reranked, trace

    def _generate(self, request, context, pipeline_trace=None) -> RAGAnswer:
        feedback = ""
        attempts: list[dict[str, Any]] = []
        for attempt in range(1, self.max_generation_attempts + 1):
            llm_request = self._llm_request(request, context, feedback)
            try:
                with trace_step("generate", impl=self._llm_name(), id=f"generate_{attempt}", trace=pipeline_trace) as step:
                    self._describe_generation(step, llm_request, attempt)
                    response = self.llm.generate(llm_request)
                    self._record_response(step, response)
                return self._validate_traced(context, response, attempt, attempts, pipeline_trace)
            except (InvalidLLMOutput, CitationValidationError) as exc:
                feedback = str(exc)
        raise RAGGenerationError("answer output failed validation")

    def _llm_name(self) -> str:
        return str(getattr(self.llm, "provider_name", None) or type(self.llm).__name__)

    def _describe_generation(self, step, llm_request: LLMRequest, attempt: int) -> None:
        prompt = self.prompts.get("answer")
        step.set_details(model=getattr(self.llm, "model", None), prompt_id=prompt.id, prompt_version=prompt.version, attempt=attempt, instructions=llm_request.instructions, allowed_citation_ids=list(llm_request.allowed_citation_ids))

    @staticmethod
    def _record_response(step, response) -> None:
        metadata = getattr(response, "metadata", {}) or {}
        step.set_details(usage=metadata.get("usage"), raw_output={"answer": response.answer, "citation_ids": list(response.citation_ids), "insufficient_evidence": response.insufficient_evidence})
        step.set_summary(f"{len(response.citation_ids)} citation(s), insufficient_evidence={response.insufficient_evidence}")

    def _validate_traced(self, context, response, attempt: int, attempts: list[dict[str, Any]], pipeline_trace=None) -> RAGAnswer:
        with trace_step("validate_citations", impl="context_ids", id=f"validate_{attempt}", trace=pipeline_trace) as step:
            try:
                answer = self._validated_answer(context, response, attempt)
            except (InvalidLLMOutput, CitationValidationError) as exc:
                attempts.append({"attempt": attempt, "valid": False, "error": str(exc)})
                step.set_details(attempts=list(attempts))
                step.set_summary(f"attempt {attempt} rejected: {exc}" + (" → retry with feedback" if attempt < self.max_generation_attempts else ""))
                step.status = "rejected"
                raise
            attempts.append({"attempt": attempt, "valid": True, "error": None})
            step.set_details(attempts=list(attempts))
            step.set_summary(f"attempt {attempt} valid: {len(answer.sources)} cited source(s) all come from the context")
            return answer

    def _llm_request(self, request, context, feedback: str) -> LLMRequest:
        instructions = self.prompts.get("answer").text
        if feedback:
            instructions += f" Your previous output was rejected: {feedback}"
        return LLMRequest(request.question, context.rendered_context, context.citation_ids, instructions)

    def _validated_answer(self, context, response, attempt: int) -> RAGAnswer:
        ids = self.validator.validate(response.citation_ids, set(context.citation_ids), answer=response.answer, insufficient_evidence=response.insufficient_evidence)
        sources = self.resolver.resolve(ids, context.documents)
        return RAGAnswer(response.answer, sources, response.insufficient_evidence, {"generation_attempts": attempt, **response.metadata})

    def with_overrides(self, **values: Any) -> RAGService:
        """A shallow copy with some attributes replaced (e.g. ``llm`` for a per-request model)."""
        clone = object.__new__(RAGService)
        clone.__dict__.update(self.__dict__)
        clone.__dict__.update(values)
        return clone


def create_rag_service(search_service, client, embedder, rag_config: RAGConfig, *, review_index_alias: str = "reviews", policy_index_alias: str = "policies", llm=None, prompts: PromptLibrary | None = None) -> RAGService:
    from shopmind.infrastructure.elasticsearch.knowledge_repository import ElasticsearchKnowledgeRepository
    from shopmind.application.knowledge.multi_source import MultiSourceRetriever
    from shopmind.application.knowledge.policy_retriever import PolicyDocumentRetriever
    from shopmind.application.knowledge.product_retriever import ProductDocumentRetriever
    from shopmind.application.knowledge.review_retriever import ReviewDocumentRetriever
    from shopmind.application.rag.citations import CitationResolver, CitationValidator
    from shopmind.application.rag.context import ContextBuilder
    from shopmind.application.rag.fusion import concatenate_documents, rrf_fuse_documents
    from shopmind.application.rag.reranker import CrossEncoderDocumentReranker, NoOpDocumentReranker
    from shopmind.infrastructure.llm.factory import build_llm

    retrieval = rag_config.retrieval
    review_repo = ElasticsearchKnowledgeRepository(client, review_index_alias, source="review")
    policy_repo = ElasticsearchKnowledgeRepository(client, policy_index_alias, source="policy")
    retrievers = {
        "product": ProductDocumentRetriever(search_service, mode=retrieval.product_mode, candidate_k=retrieval.product_candidates),
        "review": ReviewDocumentRetriever(review_repo, embedder, mode=retrieval.review_mode, candidate_k=retrieval.review_candidates, rrf_k=rag_config.fusion.rrf_k),
        "policy": PolicyDocumentRetriever(policy_repo, embedder, mode=retrieval.policy_mode, candidate_k=retrieval.policy_candidates, rrf_k=rag_config.fusion.rrf_k),
    }
    counts = {"product": retrieval.product_candidates, "review": retrieval.review_candidates, "policy": retrieval.policy_candidates}
    context_config = rag_config.context
    context = ContextBuilder(context_config.max_documents, {"product": context_config.max_product, "review": context_config.max_reviews, "policy": context_config.max_policies}, context_config.max_characters)
    reranker = CrossEncoderDocumentReranker(rag_config.reranker.model_name) if rag_config.reranker.enabled else NoOpDocumentReranker()
    prompts = prompts or default_prompts()
    if llm is None:
        llm = build_llm(rag_config.llm, prompts)
    fusion = rrf_fuse_documents if rag_config.fusion.method == "rrf" else concatenate_documents
    return RAGService(MultiSourceRetriever(retrievers, counts), fusion, reranker, context, llm, CitationValidator(), CitationResolver(), rag_config.llm.max_generation_attempts, rrf_k=rag_config.fusion.rrf_k, fused_top_k=rag_config.fusion.top_k, rerank_top_k=rag_config.reranker.top_k, prompts=prompts, fusion_name=rag_config.fusion.method)


__all__ = ["ContextConstructionError", "KnowledgeRetrievalUnavailable", "RAGApplicationError", "RAGGenerationError", "RAGService", "RerankerUnavailable", "create_rag_service"]
