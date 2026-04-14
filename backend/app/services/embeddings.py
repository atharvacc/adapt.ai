"""
Embedding service using Voyage AI for vector generation and pgvector for storage.
Falls back to a naive keyword search when Voyage API key is not configured.
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any

from sqlalchemy import select, text as sa_text
from sqlalchemy.orm import Session

from app.db.models import DocumentEmbedding

log = logging.getLogger(__name__)

VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY", "")
VOYAGE_MODEL = "voyage-3-lite"
VOYAGE_DIM = 1024
CHUNK_MAX_CHARS = 2000

_voyage_client = None


def _get_voyage():
    global _voyage_client
    if _voyage_client is not None:
        return _voyage_client
    if not VOYAGE_API_KEY:
        log.info("VOYAGE_API_KEY not set — embeddings will use fallback storage")
        return None
    try:
        import voyageai
        _voyage_client = voyageai.Client(api_key=VOYAGE_API_KEY)
        return _voyage_client
    except Exception:
        log.warning("Failed to initialize Voyage AI client")
        return None


def _chunk_text(text: str, max_chars: int = CHUNK_MAX_CHARS) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    chunks = []
    paragraphs = text.split("\n\n")
    current = ""
    for para in paragraphs:
        if len(current) + len(para) + 2 > max_chars and current:
            chunks.append(current.strip())
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current.strip():
        chunks.append(current.strip())
    return chunks if chunks else [text[:max_chars]]


def _embed_texts(texts: list[str]) -> list[list[float]] | None:
    vo = _get_voyage()
    if not vo:
        return None
    try:
        result = vo.embed(texts, model=VOYAGE_MODEL, input_type="document")
        return result.embeddings
    except Exception:
        log.exception("Voyage AI embedding failed")
        return None


def embed_and_store(
    db: Session,
    entity_type: str,
    entity_id: str,
    chunks: list[str],
    metadata: dict[str, Any] | None = None,
) -> int:
    """Embed text chunks and store them. Returns number of chunks stored."""
    db.execute(
        sa_text("DELETE FROM document_embeddings WHERE entity_type = :et AND entity_id = :eid"),
        {"et": entity_type, "eid": entity_id},
    )

    all_chunks: list[str] = []
    for chunk in chunks:
        all_chunks.extend(_chunk_text(chunk))

    embeddings = _embed_texts(all_chunks)

    stored = 0
    for i, chunk_text in enumerate(all_chunks):
        embedding_vec = embeddings[i] if embeddings else None
        record = DocumentEmbedding(
            id=str(uuid.uuid4()),
            entity_type=entity_type,
            entity_id=entity_id,
            chunk_text=chunk_text,
            chunk_index=i,
            metadata_=metadata or {},
            embedding=embedding_vec,
        )
        db.add(record)
        stored += 1

    db.commit()
    return stored


def retrieve(
    db: Session,
    query: str,
    filters: dict[str, Any] | None = None,
    top_k: int = 10,
) -> list[dict]:
    """Retrieve relevant chunks by vector similarity or text fallback."""
    query_embedding = None
    vo = _get_voyage()
    if vo:
        try:
            result = vo.embed([query], model=VOYAGE_MODEL, input_type="query")
            query_embedding = result.embeddings[0]
        except Exception:
            log.warning("Voyage query embedding failed, using text fallback")

    if query_embedding:
        return _vector_search(db, query_embedding, filters, top_k)
    return _fallback_search(db, query, filters, top_k)


def _vector_search(
    db: Session,
    query_embedding: list[float],
    filters: dict[str, Any] | None,
    top_k: int,
) -> list[dict]:
    """Use pgvector cosine distance if embeddings were stored as vectors."""
    stmt = select(DocumentEmbedding)
    if filters:
        if "entity_type" in filters:
            stmt = stmt.where(DocumentEmbedding.entity_type == filters["entity_type"])
    stmt = stmt.limit(top_k * 3)
    rows = db.execute(stmt).scalars().all()

    scored = []
    for row in rows:
        if row.embedding:
            score = _cosine_sim(query_embedding, row.embedding)
            scored.append((score, row))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [
        {
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "chunk_text": row.chunk_text,
            "metadata": row.metadata_,
            "score": round(score, 4),
        }
        for score, row in scored[:top_k]
    ]


def _fallback_search(
    db: Session,
    query: str,
    filters: dict[str, Any] | None,
    top_k: int,
) -> list[dict]:
    """Simple keyword overlap fallback when no embeddings are available."""
    stmt = select(DocumentEmbedding)
    if filters:
        if "entity_type" in filters:
            stmt = stmt.where(DocumentEmbedding.entity_type == filters["entity_type"])
    stmt = stmt.limit(200)
    rows = db.execute(stmt).scalars().all()

    query_words = set(query.lower().split())
    scored = []
    for row in rows:
        chunk_words = set(row.chunk_text.lower().split())
        overlap = len(query_words & chunk_words)
        if overlap > 0:
            scored.append((overlap, row))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [
        {
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "chunk_text": row.chunk_text,
            "metadata": row.metadata_,
            "score": score,
        }
        for score, row in scored[:top_k]
    ]


def _cosine_sim(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)
