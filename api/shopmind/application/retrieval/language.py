"""Small catalog vocabulary for lexical search, independent of evaluation labels.

Aliases translate everyday Vietnamese product/color terms and common European color metadata.
Unknown words and literal identifiers pass through unchanged. The vocabulary is data, not code:
it is read from the YAML files named in config ``vocabularies`` (``category_aliases``,
``color_aliases``; defaults under ``configs/vocab/``) and can be swapped at runtime with
``configure_vocabulary``.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULT_VOCAB_DIR = Path(__file__).resolve().parents[3] / "configs" / "vocab"
DEFAULT_PATHS = {"category_aliases": DEFAULT_VOCAB_DIR / "category_aliases.yaml", "color_aliases": DEFAULT_VOCAB_DIR / "color_aliases.yaml", "term_aliases": DEFAULT_VOCAB_DIR / "term_aliases.yaml"}
_VIETNAMESE = re.compile(r"[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]", re.IGNORECASE)
_VIETNAMESE_WORDS = re.compile(r"(?<!\w)(tìm|của|màu|cho|giá|dưới|trên|và|có|không)(?!\w)", re.IGNORECASE)


@dataclass(frozen=True)
class Vocabulary:
    categories: dict[str, str]
    colors: dict[str, tuple[str, ...]]
    # Attribute words (materials, styles): translated for lexical matching, never turned into filters.
    terms: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        translations = {**{key.casefold(): value for key, value in self.terms.items()}, **{key.casefold(): value for key, value in self.categories.items()}, **{alias.casefold(): color for color, aliases in self.colors.items() for alias in aliases}}
        pattern = re.compile(r"(?<!\w)(" + "|".join(re.escape(word) for word in sorted(translations, key=len, reverse=True)) + r")(?!\w)", re.IGNORECASE) if translations else None
        object.__setattr__(self, "_translations", translations)
        object.__setattr__(self, "_pattern", pattern)

    def kind(self, phrase: str) -> str:
        folded = phrase.casefold()
        if folded in {key.casefold() for key in self.categories}:
            return "category"
        if any(folded in (alias.casefold() for alias in aliases) for aliases in self.colors.values()):
            return "color"
        return "term"


def _read(path: str | Path) -> dict[str, Any]:
    loaded = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"vocabulary file must be a mapping: {path}")
    return loaded


def load_vocabulary(paths: dict[str, str | Path] | None = None, *, base_dir: str | Path | None = None) -> Vocabulary:
    resolved = dict(DEFAULT_PATHS)
    for name, value in (paths or {}).items():
        path = Path(value)
        if not path.is_absolute() and base_dir is not None:
            path = Path(base_dir) / path
        resolved[name] = path
    categories = {str(key): str(value) for key, value in _read(resolved["category_aliases"]).items()}
    colors = {str(key): tuple(str(alias) for alias in (value or [])) for key, value in _read(resolved["color_aliases"]).items()}
    terms_path = resolved.get("term_aliases")
    terms = {str(key): str(value) for key, value in _read(terms_path).items()} if terms_path and Path(terms_path).exists() else {}
    return Vocabulary(categories, colors, terms)


_lock = threading.Lock()
_vocabulary: Vocabulary | None = None


def vocabulary() -> Vocabulary:
    global _vocabulary
    if _vocabulary is None:
        with _lock:
            if _vocabulary is None:
                _vocabulary = load_vocabulary()
    return _vocabulary


def configure_vocabulary(paths: dict[str, str | Path] | None = None, *, base_dir: str | Path | None = None) -> Vocabulary:
    """Load (or reload) the active vocabulary from config paths."""
    global _vocabulary
    loaded = load_vocabulary(paths, base_dir=base_dir)
    with _lock:
        _vocabulary = loaded
    return loaded


def __getattr__(name: str) -> Any:  # backwards-compatible read access to the old constants
    if name == "CATEGORY_ALIASES":
        return dict(vocabulary().categories)
    if name == "COLOR_ALIASES":
        return dict(vocabulary().colors)
    raise AttributeError(name)


def explain_lexical_query(query: str) -> tuple[str, list[dict[str, str]]]:
    """Normalized lexical query plus the aliases that were applied (for the glass-box trace)."""
    vocab = vocabulary()
    applied: list[dict[str, str]] = []
    # Identifiers and brand punctuation stay literal; only the leading request verb is removed.
    result = re.sub(r"^(find|tìm)\s+", "", query, flags=re.IGNORECASE)

    def translate(match: re.Match[str]) -> str:
        target = vocab._translations[match.group().casefold()]
        applied.append({"from": match.group(), "to": target, "kind": vocab.kind(match.group())})
        return target

    if vocab._pattern is not None:
        result = vocab._pattern.sub(translate, result)
    return re.sub(r"(?<!\w)(from|in|của|màu)(?!\w)", " ", result, flags=re.IGNORECASE).strip(), applied


def normalize_lexical_query(query: str) -> str:
    return explain_lexical_query(query)[0]


def catalog_color_terms(color: str) -> str:
    value = color.strip().casefold()
    for canonical, aliases in vocabulary().colors.items():
        if value in (canonical, *aliases):
            return canonical
    return ""


def detect_language(query: str) -> str:
    """``vi`` when the query has Vietnamese diacritics or function words, else ``en``."""
    return "vi" if _VIETNAMESE.search(query) or _VIETNAMESE_WORDS.search(query) else "en"


def known_colors() -> dict[str, str]:
    """Every color spelling (canonical + aliases, casefolded) → canonical color."""
    return {alias.casefold(): canonical for canonical, aliases in vocabulary().colors.items() for alias in (canonical, *aliases)}


def canonical_color(raw: str | None) -> str | None:
    """Catalog colour value for facets/filters: the canonical vocabulary colour when any word of
    ``raw`` is a known spelling (``"Roze Roze"`` → ``pink``), else the casefolded raw value."""
    if not raw or not raw.strip():
        return None
    value = raw.strip().casefold()
    spellings = known_colors()
    if value in spellings:
        return spellings[value]
    for token in re.split(r"[\s,/&+-]+", value):
        if token in spellings:
            return spellings[token]
    return value[:64]
