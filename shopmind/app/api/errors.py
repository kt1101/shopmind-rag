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
