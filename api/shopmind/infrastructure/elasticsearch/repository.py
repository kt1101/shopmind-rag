from __future__ import annotations

import copy
import re
import threading
import time
from typing import Any

from shopmind.domain.catalog import ProductPage
from shopmind.domain.search_result import RawSearchHit
from shopmind.application.retrieval.language import normalize_lexical_query
from shopmind.infrastructure.embedding.validation import embedding_identity, validate_index_identity, validate_vectors

_FILTER_FIELDS = {"brand": "brand.keyword", "category": "category.keyword", "product_id": "product_id", "color": "color"}
_VECTOR_FIELDS = {"text_vector", "image_vector", "siglip_text_vector"}
_FACET_FIELDS = set(_FILTER_FIELDS)
_SOURCE_EXCLUDES = ["text_vector", "image_vector", "siglip_text_vector", "embedding_identities"]
_CATALOG_SOURCE_EXCLUDES = [*_SOURCE_EXCLUDES, "search_text"]
# Search hits need card fields + search_text (RAG evidence); long descriptions and the raw ABO
# metadata are only read by the product page, so ranking requests do not ship them.
_HIT_SOURCE_EXCLUDES = [*_SOURCE_EXCLUDES, "description", "metadata"]
_CATEGORY_FACET_SIZE = 300
_HIGHLIGHT_FIELDS = ("title", "brand", "category", "description", "attributes_text")
_MARK = re.compile(r"<<(.+?)>>")


class ProductIndexMissing(Exception):
    """The products index or alias does not exist."""


def _values(value: str | list[str], key: str) -> list[str]:
    raw_values = [value] if isinstance(value, str) else value
    if not raw_values or not all(isinstance(item, str) and item.strip() for item in raw_values):
        raise ValueError(f"filter {key} must contain non-empty strings")
    return list(dict.fromkeys(item.strip() for item in raw_values))


def _escape_wildcard(value: str) -> str:
    return value.replace("\\", "\\\\").replace("*", "\\*").replace("?", "\\?")


def _canonical_partial_value(key: str, value: str) -> str:
    cleaned = value.strip()
    if key == "category":
        cleaned = cleaned.replace("-", "_").replace(" ", "_")
    return _escape_wildcard(cleaned)


def build_filter_clauses(filters: dict[str, str | list[str]]) -> list[dict[str, Any]]:
    clauses: list[dict[str, Any]] = []
    for key in sorted(filters):
        if key not in _FILTER_FIELDS:
            raise ValueError(f"unsupported filter field: {key}")
        field = _FILTER_FIELDS[key]
        value = filters[key]
        values = _values(value, key)
        if len(values) == 1:
            clauses.append({"term": {field: {"value": values[0], "case_insensitive": True}}})
        else:
            clauses.append({"bool": {"should": [{"term": {field: {"value": item, "case_insensitive": True}}} for item in values], "minimum_should_match": 1}})
    return clauses


def build_partial_filter_clauses(filters: dict[str, str | list[str]]) -> list[dict[str, Any]]:
    clauses: list[dict[str, Any]] = []
    for key in sorted(filters):
        if key not in _FILTER_FIELDS:
            raise ValueError(f"unsupported filter field: {key}")
        field = _FILTER_FIELDS[key]
        values = _values(filters[key], key)
        queries = []
        for value in values:
            cleaned = _canonical_partial_value(key, value)
            if key == "product_id":
                queries.append({"prefix": {field: {"value": value.strip(), "case_insensitive": True}}})
            else:
                queries.append({"wildcard": {field: {"value": f"*{cleaned}*", "case_insensitive": True}}})
        clauses.append(queries[0] if len(queries) == 1 else {"bool": {"should": queries, "minimum_should_match": 1}})
    return clauses


def _source_without_vectors(source: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in source.items() if key not in _SOURCE_EXCLUDES}


def _matched_terms(hit: dict[str, Any]) -> dict[str, list[str]]:
    """``{field: [term, ...]}`` from an ES highlight block (markers ``<<...>>``)."""
    terms: dict[str, list[str]] = {}
    for field, fragments in (hit.get("highlight") or {}).items():
        found = [match.casefold() for fragment in fragments for match in _MARK.findall(fragment)]
        if found:
            terms[field] = list(dict.fromkeys(found))
    return terms


def _to_raw_hit(hit: dict[str, Any]) -> RawSearchHit:
    source = dict(hit.get("_source") or {})
    metadata = _source_without_vectors(source)
    matched = _matched_terms(hit)
    if matched:
        metadata["matched_terms"] = matched
    return RawSearchHit(product_id=str(source.get("product_id") or hit.get("_id") or ""), title=str(source.get("title") or ""), score=float(hit.get("_score") or 0.0), metadata=metadata)


def _public_dsl(kwargs: dict[str, Any]) -> dict[str, Any]:
    """The search request body as sent to ES (vectors elided), for the inspector's DSL tab."""
    body = {key: copy.deepcopy(value) for key, value in kwargs.items() if key not in {"index", "source_excludes"}}
    if "from_" in body:
        body["from"] = body.pop("from_")
    knn = body.get("knn")
    if isinstance(knn, dict) and "query_vector" in knn:
        knn["query_vector"] = f"<{len(knn['query_vector'])} floats>"
    return body


class ElasticsearchProductRepository:
    # Catalog facts used on every request change only when the index is rebuilt; cache them briefly.
    FILTER_CACHE_SECONDS = 300.0
    FILTER_CACHE_SIZE = 4096

    def __init__(self, client: Any, index_alias: str = "products") -> None:
        self.client = client
        self.index_alias = index_alias
        self._exists: dict[tuple[str, str], tuple[float, bool]] = {}
        self._mappings: dict[str, tuple[float, str, dict[str, Any]]] = {}
        self._identities: dict[str, dict[str, Any]] = {}
        self._cache_lock = threading.Lock()

    def _value_exists(self, exact: dict[str, Any]) -> bool:
        """Whether an exact filter value exists in the catalog (one ES count, cached per index)."""
        try:
            index = self._concrete_mapping()[0]  # alias and physical name share one cache entry
        except Exception:
            index = self.index_alias
        key = (index, repr(exact))
        now = time.monotonic()
        with self._cache_lock:
            cached = self._exists.get(key)
        if cached is not None and cached[0] > now:
            return cached[1]
        exists = self.client.count(index=self.index_alias, query=exact)["count"] > 0
        with self._cache_lock:
            if len(self._exists) >= self.FILTER_CACHE_SIZE:  # drop expired entries, then the oldest
                for stale in [k for k, (expires, _) in self._exists.items() if expires <= now] or list(self._exists)[: self.FILTER_CACHE_SIZE // 4]:
                    self._exists.pop(stale, None)
            self._exists[key] = (now + self.FILTER_CACHE_SECONDS, exists)
        return exists

    MAPPING_CACHE_SECONDS = 30.0

    def _concrete_mapping(self) -> tuple[str, dict[str, Any]]:
        """(physical index, mapping) behind ``index_alias``, re-resolved every 30 s so an alias switch
        (re-index) is followed; a new physical index is re-validated against the bound embedders."""
        now = time.monotonic()
        with self._cache_lock:
            cached = self._mappings.get(self.index_alias)
        if cached is not None and cached[0] > now:
            return cached[1], cached[2]
        mappings = self.client.indices.get_mapping(index=self.index_alias)
        if len(mappings) != 1:
            raise ValueError("vector queries require one physical index")
        concrete, mapping = next(iter(mappings.items()))
        if cached is not None and cached[1] != concrete:
            meta = mapping["mappings"].get("_meta", {}).get("embedding_identity", {})
            for field, expected in self._identities.items():
                if meta.get(field) != expected:
                    raise ValueError(f"incompatible embedding identity for {concrete}/{field}")
        with self._cache_lock:
            self._mappings[self.index_alias] = (now + self.MAPPING_CACHE_SECONDS, concrete, mapping)
        return concrete, mapping

    def bind_embedding(self, embedder: Any, field: str = "text_vector", modality: str = "text") -> None:
        """Check that the index behind the alias was built with this embedder; remembered so a later
        alias switch to a new physical index is re-validated before it is queried."""
        expected = embedding_identity(embedder, modality)
        validate_index_identity(self.client, self.index_alias, expected, field)
        self._identities[field] = expected

    def exact_id_search(self, query: str, filters: dict[str, str | list[str]]) -> list[RawSearchHit]:
        clauses = self._resolved_filter_clauses(filters)
        response = self.client.search(index=self.index_alias, query={"bool": {"filter": clauses + [{"term": {"product_id": {"value": query.strip(), "case_insensitive": True}}}]}}, size=1, source_excludes=list(_HIT_SOURCE_EXCLUDES))
        return [_to_raw_hit(hit) for hit in response.get("hits", {}).get("hits", [])]

    def ping(self) -> bool:
        return bool(self.client.ping())

    def alias_exists(self, alias: str) -> bool:
        return bool(self.client.indices.exists_alias(name=alias))

    def _resolved_filter_clauses(self, filters: dict[str, str | list[str]]) -> list[dict[str, Any]]:
        # Resolve against the catalog, not query hits: a failed query must never
        # broaden an existing brand/category or make hybrid branches disagree.
        build_filter_clauses(filters)
        clauses = []
        for key, value in sorted(filters.items()):
            alternatives = []
            for item in _values(value, key):
                exact = build_filter_clauses({key: item})[0]
                alternatives.append(exact if self._value_exists(exact) else build_partial_filter_clauses({key: item})[0])
            clauses.append(alternatives[0] if len(alternatives) == 1 else {"bool": {"should": alternatives, "minimum_should_match": 1}})
        return clauses

    def list_products(self, filters: dict[str, list[str]], offset: int, size: int) -> ProductPage:
        # Category is a post_filter so the category facet counts ignore it and stay a stable menu.
        brand_clauses = self._resolved_filter_clauses({key: value for key, value in filters.items() if key == "brand"})
        category_clauses = self._resolved_filter_clauses({key: value for key, value in filters.items() if key == "category"})
        kwargs: dict[str, Any] = {
            "index": self.index_alias,
            "query": {"bool": {"filter": brand_clauses}},
            "aggs": {"categories": {"terms": {"field": _FILTER_FIELDS["category"], "size": _CATEGORY_FACET_SIZE, "order": [{"_count": "desc"}, {"_key": "asc"}]}}},
            "sort": [{"product_id": "asc"}],
            "from_": offset,
            "size": size,
            "track_total_hits": True,
            "source_excludes": list(_CATALOG_SOURCE_EXCLUDES),
        }
        if category_clauses:
            kwargs["post_filter"] = category_clauses[0]
        response = self.client.search(**kwargs)
        hits = response.get("hits", {})
        total = hits.get("total", 0)
        total = int(total.get("value", 0)) if isinstance(total, dict) else int(total)
        buckets = response.get("aggregations", {}).get("categories", {}).get("buckets", [])
        return ProductPage(
            items=tuple(dict(hit.get("_source") or {}) for hit in hits.get("hits", [])),
            total=total,
            category_facets=tuple((str(bucket["key"]), int(bucket.get("doc_count", 0))) for bucket in buckets),
        )

    def get_product(self, product_id: str) -> dict[str, Any] | None:
        response = self.client.options(ignore_status=404).get(index=self.index_alias, id=product_id, source_excludes=list(_CATALOG_SOURCE_EXCLUDES))
        error = response.get("error")
        if error and (error.get("type") if isinstance(error, dict) else None) == "index_not_found_exception":
            raise ProductIndexMissing(self.index_alias)
        if not response.get("found"):
            return None
        return dict(response.get("_source") or {})

    def _lexical_once(self, query: str | None, size: int, clauses: list[dict[str, Any]], debug: dict[str, Any] | None = None) -> list[RawSearchHit]:
        lexical_query = normalize_lexical_query(query) if query else query
        must = [{"match_all": {}}] if query is None else [{"multi_match": {"query": lexical_query, "fields": ["title^3", "brand^2", "category^2", "description", "attributes_text", "search_text"]}}]
        search_query: dict[str, Any] = {"bool": {"must": must, "filter": clauses}}
        if query:
            search_query = {"bool": {"filter": clauses, "minimum_should_match": 1, "should": [
                must[0],
                {"match_phrase": {"title": {"query": query, "boost": 4}}},
                {"term": {"product_id": {"value": query.strip(), "case_insensitive": True, "boost": 100}}},
            ]}}
        kwargs: dict[str, Any] = {"index": self.index_alias, "query": search_query, "size": size, "source_excludes": list(_HIT_SOURCE_EXCLUDES)}
        if query is None:
            kwargs["sort"] = [{"product_id": "asc"}]
        if debug is not None:
            if query:
                kwargs["highlight"] = {"fields": {field: {} for field in _HIGHLIGHT_FIELDS}, "pre_tags": ["<<"], "post_tags": [">>"], "number_of_fragments": 3, "fragment_size": 120}
            debug["query_dsl"] = _public_dsl(kwargs)
            debug["normalized_query"] = lexical_query
        response = self.client.search(**kwargs)
        return [_to_raw_hit(hit) for hit in response.get("hits", {}).get("hits", [])]

    def lexical_search(self, query: str | None, size: int, filters: dict[str, str | list[str]], debug: dict[str, Any] | None = None) -> list[RawSearchHit]:
        """BM25 search. With ``debug`` (a dict) the ES request is recorded and hits carry the
        highlighted ``matched_terms`` per field (glass-box only: it costs a highlight pass)."""
        if size <= 0:
            raise ValueError("size must be positive")
        return self._lexical_once(query, size, self._resolved_filter_clauses(filters), debug)

    def vector_search(self, field: str, vector: list[float], size: int, num_candidates: int, filters: dict[str, str | list[str]], debug: dict[str, Any] | None = None, exclude_ids: list[str] | None = None) -> list[RawSearchHit]:
        if field not in _VECTOR_FIELDS:
            raise ValueError(f"unsupported vector field: {field}")
        if size <= 0 or num_candidates < size:
            raise ValueError("num_candidates must be >= positive size")
        concrete, mapping = self._concrete_mapping()  # kNN goes to the validated physical index
        validate_vectors([vector], int(mapping["mappings"]["properties"][field]["dims"]))
        clauses = self._resolved_filter_clauses(filters)

        def search_with(filter_clauses: list[dict[str, Any]]) -> list[RawSearchHit]:
            knn: dict[str, Any] = {"field": field, "query_vector": vector, "k": size, "num_candidates": num_candidates}
            if exclude_ids:
                filter_clauses = [*filter_clauses, {"bool": {"must_not": [{"terms": {"product_id": list(exclude_ids)}}]}}]
            if filter_clauses:
                knn["filter"] = filter_clauses[0] if len(filter_clauses) == 1 else {"bool": {"filter": filter_clauses}}
            if debug is not None:
                debug["query_dsl"] = _public_dsl({"knn": knn, "size": size})
            response = self.client.search(index=concrete, knn=knn, size=size, source_excludes=list(_HIT_SOURCE_EXCLUDES))
            return [_to_raw_hit(hit) for hit in response.get("hits", {}).get("hits", [])]

        return search_with(clauses)

    def filter_options(self, field: str, prefix: str = "", limit: int = 20) -> list[dict[str, Any]]:
        if field not in _FACET_FIELDS:
            raise ValueError(f"unsupported filter field: {field}")
        if not 1 <= limit <= 50:
            raise ValueError("limit must be between 1 and 50")
        keyword_field = _FILTER_FIELDS[field]
        kwargs: dict[str, Any] = {
            "index": self.index_alias,
            "size": 0,
            "aggs": {"options": {"terms": {"field": keyword_field, "size": limit, "order": [{"_count": "desc"}, {"_key": "asc"}]}}},
        }
        if prefix:
            escaped = _canonical_partial_value(field, prefix)
            if field == "product_id":
                kwargs["query"] = {"prefix": {keyword_field: {"value": prefix.strip(), "case_insensitive": True}}}
            else:
                kwargs["query"] = {"wildcard": {keyword_field: {"value": f"*{escaped}*", "case_insensitive": True}}}
        response = self.client.search(**kwargs)
        buckets = response.get("aggregations", {}).get("options", {}).get("buckets", [])
        return [{"value": str(bucket["key"]), "count": int(bucket.get("doc_count", 0))} for bucket in buckets]

    def describe_filters(self, filters: dict[str, str | list[str]]) -> dict[str, dict[str, Any]]:
        """How each filter value resolves against the catalog: ``exact`` match or substring/prefix
        ``fallback`` (with the catalog values the fallback matches), for the glass-box trace."""
        described: dict[str, dict[str, Any]] = {}
        for key, value in sorted(filters.items()):
            requested = _values(value, key)
            resolved: list[str] = []
            matches = set()
            for item in requested:
                exact = build_filter_clauses({key: item})[0]
                if self.client.count(index=self.index_alias, query=exact)["count"] > 0:
                    resolved.append(item)
                    matches.add("exact")
                    continue
                matches.add("fallback")
                response = self.client.search(index=self.index_alias, size=0, query=build_partial_filter_clauses({key: item})[0], aggs={"values": {"terms": {"field": _FILTER_FIELDS[key], "size": 10}}})
                resolved.extend(str(bucket["key"]) for bucket in response.get("aggregations", {}).get("values", {}).get("buckets", []))
            described[key] = {"requested": requested, "resolved": list(dict.fromkeys(resolved)), "match": "exact" if matches == {"exact"} else "fallback"}
        return described

    def facets(self, query: str | None, filters: dict[str, str | list[str]], size: int = 30) -> dict[str, list[dict[str, Any]]]:
        """Brand / category / color counts. Each facet ignores its own filter (multi-select menus)."""
        clauses = {key: self._resolved_filter_clauses({key: value})[0] for key, value in filters.items()}
        must: list[dict[str, Any]] = [{"multi_match": {"query": normalize_lexical_query(query), "fields": ["title^3", "brand^2", "category^2", "description", "attributes_text", "search_text"]}}] if query else [{"match_all": {}}]
        aggs = {}
        for name in ("brand", "category", "color"):
            others = [clause for key, clause in clauses.items() if key != name]
            aggs[name] = {"filter": {"bool": {"filter": others}} if others else {"match_all": {}}, "aggs": {"values": {"terms": {"field": _FILTER_FIELDS[name], "size": size, "order": [{"_count": "desc"}, {"_key": "asc"}]}}}}
        response = self.client.search(index=self.index_alias, size=0, query={"bool": {"must": must}}, aggs=aggs)
        result = {}
        for name in aggs:
            buckets = response.get("aggregations", {}).get(name, {}).get("values", {}).get("buckets", [])
            result[name] = [{"value": str(bucket["key"]), "count": int(bucket.get("doc_count", 0))} for bucket in buckets]
        return result

    def suggest(self, prefix: str, limit: int = 8) -> list[dict[str, Any]]:
        """Autocomplete: matching brands, categories and product titles (title phrase-prefix)."""
        prefix = prefix.strip()
        if not prefix:
            return []
        suggestions: list[dict[str, Any]] = []
        for field in ("brand", "category"):
            for option in self.filter_options(field, prefix, min(limit, 5)):
                label = option["value"].replace("_", " ").title() if field == "category" else option["value"]
                suggestions.append({"type": field, "value": option["value"], "label": label, "count": option["count"]})
        query = {"bool": {"should": [{"match_phrase_prefix": {"title": {"query": prefix, "max_expansions": 30}}}, {"term": {"product_id": {"value": prefix, "case_insensitive": True, "boost": 10}}}], "minimum_should_match": 1}}
        response = self.client.search(index=self.index_alias, size=limit, query=query, source_includes=["product_id", "title", "image_url"])
        for hit in response.get("hits", {}).get("hits", []):
            source = hit.get("_source") or {}
            suggestions.append({"type": "product", "value": str(source.get("title") or ""), "label": str(source.get("title") or ""), "product_id": str(source.get("product_id") or hit.get("_id")), "image_url": source.get("image_url")})
        return suggestions

    def all_values(self, field: str, size: int = 2000) -> list[str]:
        """Every catalog value of a keyword filter field (brand / category / color)."""
        if field not in _FACET_FIELDS:
            raise ValueError(f"unsupported filter field: {field}")
        response = self.client.search(index=self.index_alias, size=0, aggs={"values": {"terms": {"field": _FILTER_FIELDS[field], "size": size}}})
        return [str(bucket["key"]) for bucket in response.get("aggregations", {}).get("values", {}).get("buckets", [])]

    def product_vector(self, product_id: str, field: str) -> list[float] | None:
        """A stored vector of one product (for "similar items"); never leaves the API."""
        if field not in _VECTOR_FIELDS:
            raise ValueError(f"unsupported vector field: {field}")
        response = self.client.options(ignore_status=404).get(index=self.index_alias, id=product_id, source_includes=[field])
        if not response.get("found"):
            return None
        vector = (response.get("_source") or {}).get(field)
        return list(vector) if vector else None

    def _validate_bulk(self, index_name: str, documents: list[dict[str, Any]]) -> None:
        mappings = self.client.indices.get_mapping(index=index_name)
        if list(mappings) != [index_name]:
            raise ValueError("bulk writes require a physical index")
        mapping = mappings[index_name]["mappings"]
        for document in documents:
            for field in sorted(_VECTOR_FIELDS):
                if field not in document:
                    continue
                validate_vectors([document[field]], int(mapping["properties"][field]["dims"]))
                identity = mapping.get("_meta", {}).get("embedding_identity", {}).get(field)
                # Per-field identity when vectors come from several embedders, else the legacy pair.
                declared = (document.get("embedding_identities") or {}).get(field) or {"model": document.get("embedding_model"), "model_revision": document.get("embedding_version")}
                if identity and (declared.get("model") != identity["model"] or declared.get("model_revision") != identity["model_revision"]):
                    raise ValueError("document model/revision does not match index identity")

    def bulk_index(self, index_name: str, documents: list[dict[str, Any]]) -> tuple[int, list[dict[str, Any]]]:
        if not documents:
            return 0, []
        self._validate_bulk(index_name, documents)
        try:
            from elasticsearch.helpers import bulk
        except ImportError as exc:
            raise RuntimeError("elasticsearch Python package is required for bulk indexing") from exc
        actions = [{"_op_type": "index", "_index": index_name, "_id": str(document["product_id"]), "_source": document} for document in documents]
        success, errors = bulk(self.client, actions, raise_on_error=False, raise_on_exception=False, refresh=False)
        return int(success), list(errors)
