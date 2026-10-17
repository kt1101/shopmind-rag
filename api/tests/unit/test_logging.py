from __future__ import annotations

import io
import logging

import pytest
from fastapi.testclient import TestClient

import shopmind.main as main_module
from shopmind.core.logging import configure_logging, log_search_event
from tests.api.conftest import FakeEmbedder, FakeRepository, FakeSearchService


@pytest.fixture
def restore_shopmind_logger():
    logger = logging.getLogger("shopmind")
    handlers, level = list(logger.handlers), logger.level
    yield logger
    logger.handlers[:] = handlers
    logger.setLevel(level)


def test_configure_logging_emits_shopmind_info_events_to_the_stream(restore_shopmind_logger):
    stream = io.StringIO()
    configure_logging(stream=stream)

    log_search_event(logging.getLogger("shopmind.chat"), event="chat_streamed", outcome="done")
    logging.getLogger("shopmind.search").debug("not shown")

    output = stream.getvalue()
    assert '"event": "chat_streamed"' in output and '"outcome": "done"' in output
    assert "shopmind.chat" in output
    assert "not shown" not in output


def test_configure_logging_is_idempotent(restore_shopmind_logger):
    stream = io.StringIO()
    configure_logging(stream=stream)
    configure_logging(stream=stream)

    logging.getLogger("shopmind.search").info("once")

    assert stream.getvalue().count("once") == 1


def test_configure_logging_keeps_propagation_for_other_handlers(restore_shopmind_logger, caplog):
    configure_logging(stream=io.StringIO())

    with caplog.at_level(logging.INFO, logger="shopmind"):
        logging.getLogger("shopmind.search").info("visible to caplog")

    assert "visible to caplog" in caplog.text


@pytest.mark.parametrize("auto_wire,expected_calls", [(True, 1), (False, 0)])
def test_lifespan_configures_logging_only_for_the_auto_wired_app(monkeypatch, auto_wire, expected_calls):
    calls = []
    monkeypatch.setattr(main_module, "configure_logging", lambda: calls.append(True))
    app = main_module.create_app(search_service=FakeSearchService(), repository=FakeRepository(), embedder=FakeEmbedder(), auto_wire=auto_wire)

    with TestClient(app):
        pass

    assert len(calls) == expected_calls
