#!/usr/bin/env python3
"""Prepare immutable low-fidelity frames for UI-affecting BA decisions."""
import hashlib
import json
from pathlib import Path
import re


def _digest(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _require_text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} requires nonempty text")


def _validate(packet, frame):
    packet_id = packet.get("id")
    _require_text(packet_id, "packet.id")
    _require_text(frame.get("title"), "frame.title")
    if frame.get("source") not in ("authored_low_fidelity", "current_service_capture"):
        raise ValueError("frame.source must identify authored_low_fidelity or current_service_capture")
    _require_text(frame.get("alt_summary"), "frame.alt_summary")
    current = frame.get("current")
    if not isinstance(current, dict):
        raise ValueError("frame.current requires an object")
    _require_text(current.get("title"), "frame.current.title")
    if not isinstance(current.get("lines"), list) or not current["lines"] or not all(isinstance(line, str) and line.strip() for line in current["lines"]):
        raise ValueError("frame.current.lines requires nonempty text lines")
    expected = [option.get("id") for option in packet.get("options", [])]
    observed = [option.get("id") for option in frame.get("options", [])]
    if not expected or set(expected) != set(observed) or len(expected) != len(observed):
        raise ValueError("frame option IDs must exactly match packet option IDs")
    for option in frame["options"]:
        _require_text(option.get("id"), "frame.options.id")
        _require_text(option.get("title"), "frame.options.title")
        _require_text(option.get("impact"), "frame.options.impact")
        if not isinstance(option.get("lines"), list) or not option["lines"] or not all(isinstance(line, str) and line.strip() for line in option["lines"]):
            raise ValueError("frame option lines require nonempty text")


def _safe_frame_id(packet_id, content_hash):
    stem = re.sub(r"[^a-z0-9]+", "-", packet_id.lower()).strip("-") or "decision"
    return f"{stem}-{content_hash[:12]}"


def _render(packet, frame):
    option_labels = {option["id"]: option.get("label", option["id"]) for option in packet["options"]}
    lines = [f"## {frame['title']}", "", "### 현재 화면", "", f"**{frame['current']['title']}**", ""]
    lines.extend(f"- {line}" for line in frame["current"]["lines"])
    lines.extend(["", "### 선택지별 화면 변화", ""])
    for option in frame["options"]:
        label = option_labels[option["id"]]
        lines.extend([f"#### {option['id']}. {label}", ""])
        lines.extend(f"- {line}" for line in option["lines"])
        lines.extend(["", f"사용자 영향: {option['impact']}", ""])
    lines.extend(["### 이 그림의 설명", "", frame["alt_summary"], ""])
    return "\n".join(lines)


def prepare(case_dir, packet, frame):
    """Validate, render, and persist a packet-bound Markdown decision frame."""
    case = Path(case_dir).resolve()
    _validate(packet, frame)
    content = {
        "packet_id": packet["id"],
        "packet_options": [{"id": option["id"], "label": option.get("label", option["id"])} for option in packet["options"]],
        "frame": frame,
    }
    content_hash = _digest(content)
    frame_id = _safe_frame_id(packet["id"], content_hash)
    root = case / "evidence" / "decision-frames" / frame_id
    root.mkdir(parents=True, exist_ok=False)
    rendered = _render(packet, frame)
    artifact = root / "frame.md"
    artifact.write_text(rendered, encoding="utf-8")
    receipt = {
        "frame_id": frame_id,
        "packet_id": packet["id"],
        "source": frame["source"],
        "artifact_path": str(artifact.relative_to(case)),
        "content_hash": content_hash,
        "alt_summary": frame["alt_summary"],
    }
    (root / "manifest.json").write_text(json.dumps({**content, "receipt": receipt}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return receipt


def load(case_dir, receipt):
    """Return a frame only when its saved artifact still matches the receipt."""
    case = Path(case_dir).resolve()
    artifact = (case / receipt["artifact_path"]).resolve()
    if not artifact.is_relative_to(case) or not artifact.is_file():
        raise ValueError("visual frame artifact is missing or outside the case directory")
    manifest = artifact.parent / "manifest.json"
    if not manifest.is_file():
        raise ValueError("visual frame manifest is missing")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    expected_hash = _digest({"packet_id": data.get("packet_id"), "packet_options": data.get("packet_options"), "frame": data.get("frame")})
    expected_text = _render({"options": data.get("packet_options", [])}, data.get("frame", {}))
    if data.get("receipt") != receipt or expected_hash != receipt.get("content_hash") or artifact.read_text(encoding="utf-8") != expected_text:
        raise ValueError("visual frame receipt is stale or modified")
    return expected_text


def load_for_packet(case_dir, receipt, packet):
    """Return a frame only when the current packet is what the planner saw."""
    rendered = load(case_dir, receipt)
    case = Path(case_dir).resolve()
    manifest = case / receipt["artifact_path"]
    data = json.loads((manifest.parent / "manifest.json").read_text(encoding="utf-8"))
    current = [{"id": option["id"], "label": option.get("label", option["id"])} for option in packet.get("options", [])]
    if packet.get("id") != receipt.get("packet_id") or current != data.get("packet_options"):
        raise ValueError("visual frame does not match the current decision packet")
    return rendered
