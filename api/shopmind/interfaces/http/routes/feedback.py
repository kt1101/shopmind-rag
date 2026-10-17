"""Public feedback loop (F4): thumbs up/down on search results and answers, result clicks."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from shopmind.interfaces.http.admin_support import need

router = APIRouter(prefix="/api/v1", tags=["feedback"])


class FeedbackIn(BaseModel):
    target: Literal["search", "answer"]
    trace_id: str = Field(min_length=1, max_length=64)
    rating: Literal[1, -1]
    product_id: str | None = Field(default=None, max_length=64)
    query: str | None = Field(default=None, max_length=1000)
    comment: str | None = Field(default=None, max_length=2000)


class ClickIn(BaseModel):
    trace_id: str = Field(min_length=1, max_length=64)
    product_id: str = Field(min_length=1, max_length=64)
    rank: int = Field(ge=1, le=10000)


@router.post("/feedback", status_code=201)
def submit_feedback(payload: FeedbackIn, request: Request) -> dict[str, Any]:
    feedback_id = need(request, "event_log").add_feedback(target=payload.target, trace_id=payload.trace_id, rating=payload.rating, product_id=payload.product_id, query=payload.query, comment=payload.comment)
    return {"id": feedback_id}


@router.post("/events/click", status_code=204)
def record_click(payload: ClickIn, request: Request) -> Response:
    need(request, "event_log").record_click(payload.trace_id, payload.product_id, payload.rank)
    return Response(status_code=204)
