from typing import Literal
from pydantic import BaseModel, Field

Platform = Literal["linkedin", "x", "instagram", "facebook"]


class RunCreateRequest(BaseModel):
    source_content: str = Field(min_length=20)
    platforms: list[Platform] = [
        "linkedin",
        "x",
        "instagram",
        "facebook",
    ]


class Variant(BaseModel):
    id: str
    label: Literal["A", "B", "C"]
    text: str
    rationale: str
    status: Literal["generated", "accepted", "edited", "rejected"] = "generated"
    hook_type: str | None = None
    consistency_score: int | None = None
    image_prompt: str | None = None
    image_url: str | None = None


class PlatformOutput(BaseModel):
    platform: Platform
    variants: list[Variant]


class RunResponse(BaseModel):
    run_id: str
    outputs: list[PlatformOutput]


class VariantUpdateRequest(BaseModel):
    text: str | None = None
    status: Literal["generated", "accepted", "edited", "rejected"] | None = None


class VariantRegenerateRequest(BaseModel):
    context: str | None = None
