from __future__ import annotations

from typing import Any

from shopmind.app.domain.catalog import ProductPage
from shopmind.app.domain.search_result import RawSearchHit
from shopmind.app.retrieval.language import normalize_lexical_query
from shopmind.app.embedding.validation import embedding_identity, validate_index_identity, validate_vectors

_FILTER_FIELDS = {"brand": "brand.keyword", "category": "category.keyword", "product_id": "product_id"}
_VECTOR_FIELDS = {"text_vector", "image_vector"}
_FACET_FIELDS = set(_FILTER_FIELDS)
_CATALOG_SOURCE_EXCLUDES = ["text_vector", "image_vector", "search_text"]
_CATEGORY_FACET_SIZE = 300


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
    return {key: value for key, value in source.items() if key not in {"text_vector", "image_vector"}}


def _to_raw_hit(hit: dict[str, Any]) -> RawSearchHit:
    source = dict(hit.get("_source") or {})
    return RawSearchHit(product_id=str(source.get("product_id") or hit.get("_id") or ""), title=str(source.get("title") or ""), score=float(hit.get("_score") or 0.0), metadata=_source_without_vectors(source))


class ElasticsearchProductRepository:
    def __init__(self, client: Any, index_alias: str = "products") -> None:
        self.client = client
        self.index_alias = index_alias

    def bind_embedding(self, embedder: Any, field: str = "text_vector", modality: str = "text") -> None:
        self.index_alias = validate_index_identity(self.client, self.index_alias, embedding_identity(embedder, modality), field)

    def exact_id_search(self, query: str, filters: dict[str, str | list[str]]) -> list[RawSearchHit]:
        clauses = self._resolved_filter_clauses(filters)
        response = self.client.search(index=self.index_alias, query={"bool": {"filter": clauses + [{"term": {"product_id": {"value": query.strip(), "case_insensitive": True}}}]}}, size=1, source_excludes=["text_vector", "image_vector"])
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
                exists = self.client.count(index=self.index_alias, query=exact)["count"] > 0
                alternatives.append(exact if exists else build_partial_filter_clauses({key: item})[0])
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

    def _lexical_once(self, query: str | None, size: int, clauses: list[dict[str, Any]]) -> list[RawSearchHit]:
        lexical_query = normalize_lexical_query(query) if query else query
        must = [{"match_all": {}}] if query is None else [{"multi_match": {"query": lexical_query, "fields": ["title^3", "brand^2", "category^2", "description", "attributes_text", "search_text"]}}]
        search_query: dict[str, Any] = {"bool": {"must": must, "filter": clauses}}
        if query:
            search_query = {"bool": {"filter": clauses, "minimum_should_match": 1, "should": [
                must[0],
                {"match_phrase": {"title": {"query": query, "boost": 4}}},
                {"term": {"product_id": {"value": query.strip(), "case_insensitive": True, "boost": 100}}},
            ]}}
        kwargs: dict[str, Any] = {"index": self.index_alias, "query": search_query, "size": size, "source_excludes": ["text_vector", "image_vector"]}
        if query is None:
            kwargs["sort"] = [{"product_id": "asc"}]
        response = self.client.search(**kwargs)
        return [_to_raw_hit(hit) for hit in response.get("hits", {}).get("hits", [])]

    def lexical_search(self, query: str | None, size: int, filters: dict[str, str | list[str]]) -> list[RawSearchHit]:
        if size <= 0:
            raise ValueError("size must be positive")
        return self._lexical_once(query, size, self._resolved_filter_clauses(filters))

    def vector_search(self, field: str, vector: list[float], size: int, num_candidates: int, filters: dict[str, str | list[str]]) -> list[RawSearchHit]:
        if field not in _VECTOR_FIELDS:
            raise ValueError(f"unsupported vector field: {field}")
        if size <= 0 or num_candidates < size:
            raise ValueError("num_candidates must be >= positive size")
        mappings = self.client.indices.get_mapping(index=self.index_alias)
        if len(mappings) != 1:
            raise ValueError("vector queries require one physical index")
        self.index_alias, mapping = next(iter(mappings.items()))
        validate_vectors([vector], int(mapping["mappings"]["properties"][field]["dims"]))
        clauses = self._resolved_filter_clauses(filters)

        def search_with(filter_clauses: list[dict[str, Any]]) -> list[RawSearchHit]:
            knn: dict[str, Any] = {"field": field, "query_vector": vector, "k": size, "num_candidates": num_candidates}
            if filter_clauses:
                knn["filter"] = filter_clauses[0] if len(filter_clauses) == 1 else {"bool": {"filter": filter_clauses}}
            response = self.client.search(index=self.index_alias, knn=knn, size=size, source_excludes=["text_vector", "image_vector"])
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

    def _validate_bulk(self, index_name: str, documents: list[dict[str, Any]]) -> None:
        mappings = self.client.indices.get_mapping(index=index_name)
        if list(mappings) != [index_name]:
            raise ValueError("bulk writes require a physical index")
        mapping = mappings[index_name]["mappings"]
        for document in documents:
            for field in ("text_vector", "image_vector"):
                if field not in document:
                    continue
                validate_vectors([document[field]], int(mapping["properties"][field]["dims"]))
                identity = mapping.get("_meta", {}).get("embedding_identity", {}).get(field)
                if identity and (document.get("embedding_model") != identity["model"] or document.get("embedding_version") != identity["model_revision"]):
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
