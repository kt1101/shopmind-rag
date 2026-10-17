"""Versioned prompt files (config ``prompts: {id: path}``), never prompt text in code.

``answer.v1.md`` → id ``answer``, version ``v1``. Without configuration the files shipped in
``configs/prompts/`` are used, so tests and scripts see the same text as the running app.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PROMPT_DIR = Path(__file__).resolve().parents[3] / "configs" / "prompts"
_VERSION = re.compile(r"\.(v\d+[\w-]*)\.[a-z]+$")


@dataclass(frozen=True)
class Prompt:
    id: str
    version: str
    text: str
    path: str


class PromptLibrary:
    def __init__(self, paths: dict[str, str] | None = None) -> None:
        self.paths = dict(paths or {})
        self._cache: dict[str, Prompt] = {}

    def _path(self, prompt_id: str) -> Path:
        if prompt_id in self.paths:
            return Path(self.paths[prompt_id])
        candidates = sorted(DEFAULT_PROMPT_DIR.glob(f"{prompt_id}.v*.md"))
        if not candidates:
            raise KeyError(f"prompt {prompt_id!r} is not configured and no default file exists")
        return candidates[-1]

    def get(self, prompt_id: str) -> Prompt:
        if prompt_id not in self._cache:
            path = self._path(prompt_id)
            match = _VERSION.search(path.name)
            self._cache[prompt_id] = Prompt(prompt_id, match.group(1) if match else "unversioned", path.read_text(encoding="utf-8").strip(), str(path))
        return self._cache[prompt_id]


_default = PromptLibrary()


def default_prompts() -> PromptLibrary:
    return _default
