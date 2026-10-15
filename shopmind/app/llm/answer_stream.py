"""Incrementally extract the ``answer`` string from a streamed JSON object.

The model streams ``{"answer": ..., "citation_ids": [...], ...}`` as raw JSON
text deltas. ``AnswerFieldExtractor`` is a character state machine that decodes
the depth-1 ``answer`` string as its characters arrive, so callers can forward
text before the JSON is complete. Chunks may split anywhere, including inside
an escape sequence or between the two ``\\uXXXX`` halves of a surrogate pair.
"""

from __future__ import annotations

_SCAN = "scan"  # structural characters outside strings
_SKIP_STRING = "skip_string"  # a string we do not capture (values, nested keys)
_KEY = "key"  # a depth-1 key string being compared with the target
_SEEK_COLON = "seek_colon"
_SEEK_QUOTE = "seek_quote"
_IN_VALUE = "in_value"
_ESCAPE = "escape"
_UNICODE = "unicode"
_DONE = "done"

_SIMPLE_ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}
_REPLACEMENT = "�"


class AnswerFieldExtractor:
    def __init__(self, field: str = "answer") -> None:
        self._field = field
        self._state = _SCAN
        self._depth = 0
        self._expect_key = False  # at depth 1, the next string is a key (follows `{` or `,`)
        self._in_escape = False  # inside _SKIP_STRING / _KEY: previous char was a backslash
        self._key: list[str] = []
        self._hex: list[str] = []
        self._high_surrogate: int | None = None

    @property
    def done(self) -> bool:
        return self._state == _DONE

    def feed(self, chunk: str) -> str:
        out: list[str] = []
        for char in chunk:
            if self._state == _DONE:
                break
            self._step(char, out)
        return "".join(out)

    def _step(self, char: str, out: list[str]) -> None:
        state = self._state
        if state == _IN_VALUE:
            if char == '"':
                self._flush_surrogate(out)
                self._state = _DONE
            elif char == "\\":
                self._state = _ESCAPE
            else:
                self._flush_surrogate(out)
                out.append(char)
        elif state == _ESCAPE:
            if char == "u":
                self._hex = []
                self._state = _UNICODE
            else:
                self._flush_surrogate(out)
                out.append(_SIMPLE_ESCAPES.get(char, char))
                self._state = _IN_VALUE
        elif state == _UNICODE:
            self._hex.append(char)
            if len(self._hex) == 4:
                self._emit_code_unit("".join(self._hex), out)
                self._state = _IN_VALUE
        elif state == _SCAN:
            self._scan(char)
        elif state in (_SKIP_STRING, _KEY):
            self._skip_or_key(char)
        elif state == _SEEK_COLON:
            if char == ":":
                self._state = _SEEK_QUOTE
            elif not char.isspace():
                self._state = _SCAN
        elif state == _SEEK_QUOTE:
            if char == '"':
                self._state = _IN_VALUE
            elif not char.isspace():
                self._state = _SCAN  # answer is not a string; nothing to capture

    def _scan(self, char: str) -> None:
        if char == '"':
            if self._depth == 1 and self._expect_key:
                self._key = []
                self._state = _KEY
            else:
                self._state = _SKIP_STRING
            self._in_escape = False
        elif char in "{[":
            self._depth += 1
            self._expect_key = char == "{"
        elif char in "}]":
            self._depth -= 1
        elif char == ",":
            self._expect_key = True
        elif char == ":":
            self._expect_key = False

    def _skip_or_key(self, char: str) -> None:
        if self._in_escape:
            self._in_escape = False
        elif char == "\\":
            self._in_escape = True
        elif char == '"':
            if self._state == _KEY and "".join(self._key) == self._field:
                self._state = _SEEK_COLON
            else:
                self._state = _SCAN
            self._expect_key = False
            return
        if self._state == _KEY:
            self._key.append(char)  # escapes stay raw, so they never match the field name

    def _emit_code_unit(self, hex_digits: str, out: list[str]) -> None:
        try:
            code = int(hex_digits, 16)
        except ValueError:
            self._flush_surrogate(out)
            out.append(_REPLACEMENT)
            return
        if self._high_surrogate is not None:
            high, self._high_surrogate = self._high_surrogate, None
            if 0xDC00 <= code <= 0xDFFF:
                out.append(chr(0x10000 + ((high - 0xD800) << 10) + (code - 0xDC00)))
                return
            out.append(_REPLACEMENT)
        if 0xD800 <= code <= 0xDBFF:
            self._high_surrogate = code
        elif 0xDC00 <= code <= 0xDFFF:
            out.append(_REPLACEMENT)
        else:
            out.append(chr(code))

    def _flush_surrogate(self, out: list[str]) -> None:
        if self._high_surrogate is not None:
            self._high_surrogate = None
            out.append(_REPLACEMENT)
