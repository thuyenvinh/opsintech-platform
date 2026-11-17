"""Text extraction utilities for Native RAG document ingestion."""

from html.parser import HTMLParser
import io
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

_PLAIN_TEXT_EXTS = {".txt", ".md", ".csv", ".json", ".log", ".yaml", ".yml"}
_HTML_EXTS = {".html", ".htm"}


class _HTMLTextExtractor(HTMLParser):
    """Strip HTML tags while ignoring script and style blocks."""

    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lower = tag.lower()
        if lower in {"script", "style", "noscript"}:
            self._skip_depth += 1
        elif lower in {"p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        lower = tag.lower()
        if lower in {"script", "style", "noscript"} and self._skip_depth > 0:
            self._skip_depth -= 1
        elif lower in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(data)

    def get_text(self) -> str:
        raw = "".join(self._parts)
        return re.sub(r"\n{3,}", "\n\n", raw).strip()


def _decode_bytes(content: bytes) -> str:
    """Decode bytes using UTF-8 (with BOM support) and fallback to latin-1."""
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _extract_docx(content: bytes) -> str:
    """Extract paragraph text from a .docx archive via word/document.xml."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            if "word/document.xml" not in zf.namelist():
                raise ValueError("Invalid DOCX file: missing word/document.xml")
            xml_bytes = zf.read("word/document.xml")
    except zipfile.BadZipFile as exc:
        raise ValueError("Invalid DOCX file: corrupted zip archive") from exc

    root = ET.fromstring(xml_bytes)
    paragraphs: list[str] = []
    for elem in root.iter():
        if elem.tag.endswith("}p") or elem.tag == "p":
            texts = [
                node.text
                for node in elem.iter()
                if (node.tag.endswith("}t") or node.tag == "t") and node.text
            ]
            line = "".join(texts).strip()
            if line:
                paragraphs.append(line)
    return "\n\n".join(paragraphs)


def _extract_pdf(content: bytes) -> str:
    """Extract text from a PDF using pypdf or pymupdf if installed."""
    try:
        import pypdf  # type: ignore[import-not-found]

        reader = pypdf.PdfReader(io.BytesIO(content))
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
        return "\n\n".join(p for p in pages if p)
    except ImportError:
        pass

    try:
        import fitz  # type: ignore[import-not-found]

        with fitz.open(stream=content, filetype="pdf") as doc:
            pages = [(page.get_text() or "").strip() for page in doc]
        return "\n\n".join(p for p in pages if p)
    except ImportError as exc:
        raise RuntimeError(
            "PDF extraction requires 'pypdf' or 'pymupdf' to be installed."
        ) from exc


def extract_text_from_bytes(
    filename: str,
    content: bytes,
    content_type: str | None = None,
) -> str:
    """Extract plain text from uploaded document bytes.

    Supports `.txt`, `.md`, `.csv`, `.json`, `.log`, `.yaml`, `.yml`,
    `.html`/`.htm`, `.docx`, and `.pdf` (when `pypdf` or `pymupdf` is available).
    """
    ext = Path(filename).suffix.lower()
    ctype = (content_type or "").split(";")[0].strip().lower()

    if ext in _PLAIN_TEXT_EXTS or (not ext and ctype in {"text/plain", "text/markdown", "text/csv", "application/json"}):
        return _decode_bytes(content)

    if ext in _HTML_EXTS or (not ext and ctype == "text/html"):
        parser = _HTMLTextExtractor()
        parser.feed(_decode_bytes(content))
        parser.close()
        return parser.get_text()

    if ext == ".docx" or (
        not ext and ctype == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        return _extract_docx(content)

    if ext == ".pdf" or (not ext and ctype == "application/pdf"):
        return _extract_pdf(content)

    raise ValueError(f"Unsupported file format for RAG ingestion: {ext or content_type or filename}")
