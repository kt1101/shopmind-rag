class SearchApplicationError(Exception):
    """Base exception exposed above the application service boundary."""


class SearchInfrastructureError(SearchApplicationError):
    """Search storage/runtime dependency failed."""


class UnsupportedSearchMode(SearchApplicationError):
    """Requested retrieval strategy is not supported."""


class EmbeddingUnavailable(SearchApplicationError):
    """Embedding model/provider is not ready for a requested operation."""


class InvalidFilter(SearchApplicationError):
    """A requested public filter field is not supported."""


class InvalidImage(SearchApplicationError):
    """Uploaded bytes are not a supported decodable image."""


class InvalidPagination(SearchApplicationError):
    """Requested page lies outside the retrievable candidate window."""


class ImageTooLarge(SearchApplicationError):
    """Uploaded image exceeds the configured request limit."""


class ProductNotFound(SearchApplicationError):
    """Requested product does not exist in the catalog."""


# --- HTTP error mapping -------------------------------------------------------------------------
# One table instead of one handler per exception. Subsystems add their own mappings with
# ``register_error(ExceptionType, status, code)`` from their router module (imported at startup).
# Lookup walks the exception's MRO, so the most specific registered class wins.

ERROR_MAP: dict[type[BaseException], tuple[int, str]] = {
    UnsupportedSearchMode: (400, "unsupported_search_mode"),
    InvalidFilter: (400, "invalid_filter"),
    InvalidImage: (400, "invalid_image"),
    InvalidPagination: (422, "invalid_pagination"),
    ProductNotFound: (404, "product_not_found"),
    ImageTooLarge: (413, "image_too_large"),
    EmbeddingUnavailable: (503, "embedding_unavailable"),
    SearchInfrastructureError: (503, "search_infrastructure_unavailable"),
}


def register_error(exc_type: type[BaseException], status: int, code: str) -> None:
    ERROR_MAP[exc_type] = (status, code)


def lookup_error(exc: BaseException) -> tuple[int, str] | None:
    for cls in type(exc).__mro__:
        if cls in ERROR_MAP:
            return ERROR_MAP[cls]
    return None


class NotAuthenticated(Exception):
    """Missing or invalid bearer token for a protected endpoint."""


class TraceNotFound(Exception):
    """Requested trace id is unknown or expired."""


register_error(NotAuthenticated, 401, "unauthorized")
register_error(TraceNotFound, 404, "trace_not_found")
