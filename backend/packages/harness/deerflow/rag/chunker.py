"""Paragraph- and sentence-aware text chunker for Native RAG."""

import re

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _split_oversized_unit(unit: str, chunk_size: int) -> list[str]:
    """Split a single unit larger than chunk_size by lines, sentences, words, or chars."""
    if len(unit) <= chunk_size:
        return [unit]

    parts: list[str] = []
    # Try single newlines first, then sentences
    sub_units = unit.splitlines() if "\n" in unit else _SENTENCE_SPLIT_RE.split(unit)
    if len(sub_units) == 1:
        sub_units = unit.split(" ")

    current = ""
    for sub in sub_units:
        sub = sub.strip()
        if not sub:
            continue
        if len(sub) > chunk_size:
            if current:
                parts.append(current)
                current = ""
            # Hard character slice as last resort
            for i in range(0, len(sub), chunk_size):
                parts.append(sub[i : i + chunk_size])
            continue

        candidate = f"{current} {sub}".strip() if current else sub
        if len(candidate) <= chunk_size:
            current = candidate
        else:
            if current:
                parts.append(current)
            current = sub

    if current:
        parts.append(current)
    return parts


def _overlap_tail(text: str, overlap: int) -> str:
    """Return up to `overlap` trailing characters aligned to a word boundary when possible."""
    if overlap <= 0 or not text:
        return ""
    if len(text) <= overlap:
        return text
    tail = text[-overlap:]
    space_idx = tail.find(" ")
    if 0 < space_idx < len(tail) - 1:
        return tail[space_idx + 1 :].strip()
    return tail.strip()


def chunk_text(
    text: str,
    chunk_size: int = 800,
    chunk_overlap: int = 120,
) -> list[str]:
    """Split text into overlapping chunks respecting paragraph and sentence boundaries."""
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    overlap = max(0, min(chunk_overlap, chunk_size - 1))

    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    raw_paragraphs = [p.strip() for p in re.split(r"\n{2,}", normalized) if p.strip()]
    units: list[str] = []
    for para in raw_paragraphs:
        units.extend(_split_oversized_unit(para, chunk_size))

    chunks: list[str] = []
    current = ""
    for unit in units:
        if not current:
            current = unit
            continue

        separator = "\n\n" if len(current) + 2 + len(unit) <= chunk_size else " "
        if len(current) + len(separator) + len(unit) <= chunk_size:
            current = f"{current}{separator}{unit}"
            continue

        chunks.append(current)
        tail = _overlap_tail(current, overlap)
        if tail and len(tail) + 1 + len(unit) <= chunk_size:
            current = f"{tail} {unit}".strip()
        else:
            current = unit

    if current:
        chunks.append(current)

    return chunks
