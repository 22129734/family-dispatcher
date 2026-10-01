"""Stateless-песочница ядра: извлечение и распределение без базы данных."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.schemas.family import Family
from app.schemas.task import Assignment, TaskDraft
from app.services.allocator import Allocator, NoEligibleMemberError, invisible_labour_index
from app.services.task_extractor import TaskExtractor

router = APIRouter(prefix="/api/v1/playground", tags=["playground"])

extractor = TaskExtractor()
allocator = Allocator()


class ExtractRequest(BaseModel):
    message: str


class DispatchRequest(BaseModel):
    message: str
    family: Family


@router.post("/tasks/extract", response_model=TaskDraft, summary="Извлечь задачу из сообщения")
def extract_task(payload: ExtractRequest) -> TaskDraft:
    return extractor.extract(payload.message)


@router.post("/tasks/dispatch", response_model=Assignment, summary="Извлечь и распределить задачу")
def dispatch_task(payload: DispatchRequest) -> Assignment:
    task = extractor.extract(payload.message)
    try:
        return allocator.allocate(payload.family, task)
    except NoEligibleMemberError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/family/labour-index", summary="Индекс невидимого труда по семье")
def labour_index(family: Family) -> dict[str, float]:
    return invisible_labour_index(family)
