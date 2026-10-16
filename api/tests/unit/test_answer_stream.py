from __future__ import annotations

import json

import pytest

from shopmind.infrastructure.llm.answer_stream import AnswerFieldExtractor

CASE = {
    "answer": 'Line "one"\n\\ Xin chào 😀 é\t/ \b\f\r',
    "citation_ids": ["product:P1"],
    "insufficient_evidence": False,
}


def _feed_all(raw: str, size: int = 1) -> tuple[str, AnswerFieldExtractor]:
    extractor = AnswerFieldExtractor()
    text = "".join(extractor.feed(raw[i : i + size]) for i in range(0, len(raw), size))
    return text, extractor


@pytest.mark.parametrize("ensure_ascii", [True, False])
@pytest.mark.parametrize("size", [1, 2, 3, 7, 10_000])
def test_chunked_decoding_matches_json(size, ensure_ascii):
    raw = json.dumps(CASE, ensure_ascii=ensure_ascii)
    text, extractor = _feed_all(raw, size)
    assert text == CASE["answer"]
    assert extractor.done


@pytest.mark.parametrize("size", [1, 2, 3, 5])
def test_answer_key_not_first(size):
    raw = json.dumps({"citation_ids": ["a"], "insufficient_evidence": True, "answer": "last é"}, ensure_ascii=True)
    assert _feed_all(raw, size)[0] == "last é"


def test_output_grows_incrementally():
    extractor = AnswerFieldExtractor()
    assert extractor.feed('{"ans') == ""
    assert extractor.feed('wer": "Hel') == "Hel"
    assert extractor.feed("lo ") == "lo "
    assert not extractor.done
    assert extractor.feed('world"}') == "world"
    assert extractor.done


@pytest.mark.parametrize(
    "raw",
    [
        '{"meta": {"answer": "decoy"}, "citation_ids": ["answer"], "x": "answer", "answer": "real"}',
        '{"x": "answer", "y": ["answer", {"answer": "decoy"}], "answer": "real"}',
        '{"x": "a\\"nswer", "answer": "real"}',
    ],
)
def test_only_depth_one_key_counts(raw):
    assert _feed_all(raw)[0] == "real"
    assert _feed_all(raw, 10_000)[0] == "real"


def test_surrogate_pair_split_across_chunks():
    raw = '{"answer": "\\ud83d\\ude00!"}'
    for split in range(1, len(raw)):
        extractor = AnswerFieldExtractor()
        assert extractor.feed(raw[:split]) + extractor.feed(raw[split:]) == "😀!"


def test_lone_surrogate_becomes_replacement_char():
    assert _feed_all('{"answer": "a\\ud83db"}')[0] == "a�b"
    assert _feed_all('{"answer": "a\\ude00b"}')[0] == "a�b"
    assert _feed_all('{"answer": "a\\ud83d"}')[0] == "a�"
    assert _feed_all('{"answer": "a\\ud83d\\n"}')[0] == "a�\n"


def test_no_output_after_closing_quote():
    extractor = AnswerFieldExtractor()
    assert extractor.feed('{"answer": "hi"') == "hi"
    assert extractor.done
    assert extractor.feed(', "citation_ids": ["answer"], "answer": "again"}') == ""
    assert extractor.feed("more") == ""


def test_no_answer_key_yields_nothing():
    text, extractor = _feed_all('{"citation_ids": [], "insufficient_evidence": true}')
    assert text == ""
    assert not extractor.done


@pytest.mark.parametrize("escape", ["\\u-123", "\\u0x12", "\\u1_23", "\\u 123", "\\u+123", "\\u12g4"])
def test_malformed_unicode_escape_becomes_replacement_char(escape):
    raw = '{"answer": "a' + escape + 'b"}'
    expected = "a\ufffdb"
    for split in range(1, len(raw)):
        extractor = AnswerFieldExtractor()
        assert extractor.feed(raw[:split]) + extractor.feed(raw[split:]) == expected
    assert _feed_all(raw)[0] == expected


def test_fullwidth_digit_escape_is_not_accepted():
    # U+FF11 U+FF12 U+FF13 U+FF14 are valid int() digits but not JSON hex digits
    raw = '{"answer": "a\\u\uff11\uff12\uff13\uff14b"}'
    assert _feed_all(raw)[0] == "a\ufffdb"
    assert _feed_all(raw, 3)[0] == "a\ufffdb"


def test_non_string_answer_value_does_not_break_depth_tracking():
    raw = '{"answer": {"a":1}, "x":"y", "answer":"z"}'
    assert _feed_all(raw)[0] == "z"
    assert _feed_all(raw, 10_000)[0] == "z"


def test_whitespace_around_colon():
    assert _feed_all('{"answer" :   "x"}')[0] == "x"
    assert _feed_all('{"answer"\n:\n"x"}', 2)[0] == "x"


def test_skipped_value_ending_in_escaped_backslash():
    raw = '{"x": "a\\\\", "answer": "real"}'
    assert _feed_all(raw)[0] == "real"
    assert _feed_all(raw, 10_000)[0] == "real"
