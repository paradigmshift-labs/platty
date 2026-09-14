#!/usr/bin/env python3
"""Bridge BA wireframe records to the project-local Node design pipeline."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid

import design_system_wireframe
import design_tokens
import screen_behavior
import wireframe_adapter
from paths import PLUGIN_ROOT, WORKSPACE_ROOT

ROOT = PLUGIN_ROOT
ENGINE_CLI = PLUGIN_ROOT / "design-pipeline/src/cli.mjs"
PACK_ROOT = WORKSPACE_ROOT / "design-knowledge"


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="." + path.name, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def atomic_json_if_changed(path, value):
    path = Path(path)
    serialized = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == serialized:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="." + path.name, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(serialized)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        return True
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def now():
    return datetime.now(timezone.utc).isoformat()


def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def append_journal(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, sort_keys=True)
        stream.write("\n")


def read_journal(path):
    path = Path(path)
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def latest_stage_decision_id(case_root):
    if not case_root:
        return None
    for row in reversed(read_journal(Path(case_root) / "evidence/decisions.jsonl")):
        if row.get("interview_stage") == "design_system_wireframe" and row.get("id"):
            return row["id"]
    return None


def rel(case_root, path):
    return str(Path(path).resolve().relative_to(Path(case_root).resolve()))


def summarize_engine_result(command, result):
    if not isinstance(result, dict):
        return {}
    if result.get("summary_schema_version") == 1 or result.get("command") == command:
        return {
            key: result.get(key)
            for key in (
                "command", "runId", "runDir", "valid", "pass", "reused",
                "target_id", "targetId",
                "capture_count", "unique_image_count",
                "transition_evidence_count", "artifact_count", "frozenAt",
                "verdict", "error_count", "errors", "retryStage", "reviewId",
                "target_count", "ready_for_confirmation", "complete",
            )
            if key in result
        }
    if command == "prepare":
        return {"runId": result.get("runId"), "runDir": result.get("runDir")}
    if command == "spec":
        return {
            "valid": result.get("valid"),
            "error_count": len(result.get("errors", [])),
            "target_id": result.get("target_id") or result.get("targetId") or result.get("designSpec", {}).get("target_id", "") or result.get("designSpec", {}).get("targetId", ""),
            "component_count": len(result.get("componentMappings", [])),
            "token_count": len(result.get("tokenMappings", [])),
        }
    if command == "runtime":
        return {
            "pass": result.get("pass"),
            "capture_count": len(result.get("captures", [])),
            "transition_evidence_count": len(result.get("transitionEvidence", [])),
            "actions": result.get("actions", {}),
        }
    if command == "freeze":
        return {"artifact_count": len(result.get("artifacts", {})), "frozenAt": result.get("frozenAt", "")}
    if command == "gate":
        return {
            "verdict": result.get("verdict"),
            "error_count": len(result.get("errors", [])),
            "errors": result.get("errors", []),
            "retryStage": result.get("retryStage", ""),
            "reviewId": result.get("reviewId", ""),
        }
    if command == "sync":
        return {
            "target_count": len(result.get("target_results", [])),
            "ready_for_confirmation": result.get("validation", {}).get("ready_for_confirmation"),
            "complete": result.get("validation", {}).get("complete"),
        }
    return {key: result.get(key) for key in ("status", "verdict", "runId") if key in result}


def write_engine_manifest(command, args, cwd, started_at, duration_ms, proc, result, run_dir):
    if run_dir is None:
        return
    manifest = {
        "schema_version": 1,
        "command": command,
        "argv": args,
        "cwd": str(cwd),
        "started_at": started_at,
        "finished_at": now(),
        "duration_ms": round(duration_ms, 3),
        "exit_code": proc.returncode,
        "stdout_sha256": sha256_text(proc.stdout or ""),
        "stderr_sha256": sha256_text(proc.stderr or ""),
        "run_id": result.get("runId") if isinstance(result, dict) and result.get("runId") else Path(run_dir).name,
        "result_summary": summarize_engine_result(command, result) if proc.returncode == 0 else {},
        "error": (proc.stderr or proc.stdout).strip() if proc.returncode != 0 else "",
    }
    atomic_json(Path(run_dir) / (command + "-command.json"), manifest)


def record_common_engine_event(case_root, command, target_id, run_id, result, started_at, duration_ms, error=None):
    if not case_root:
        return
    case_root = Path(case_root)
    session = load_json(case_root / "session.json") if (case_root / "session.json").exists() else {}
    event_id = "e-" + uuid.uuid4().hex
    previous = read_journal(case_root / "evidence/trace.jsonl")
    receipt_id = "t-" + uuid.uuid4().hex
    decision_id = latest_stage_decision_id(case_root)
    receipt = {
        "tool": "design-pipeline " + command if command != "sync" else "wireframe_run sync",
        "arguments": {"command": command, "target_id": target_id or "", "run_id": run_id or ""},
        "result": summarize_engine_result(command, result) if error is None else {"error": error},
        "is_error": error is not None,
    }
    append_journal(case_root / "evidence/tool-events.jsonl", {
        "id": receipt_id,
        "mode": session.get("mode", "unrecorded"),
        "recorded_at": now(),
        "interview_stage": "design_system_wireframe",
        "decision_id": decision_id,
        "receipt": receipt,
    })
    append_journal(case_root / "evidence/trace.jsonl", {
        "schema_version": 1,
        "id": event_id,
        "operation_id": None,
        "sequence": previous[-1]["sequence"] + 1 if previous else 1,
        "previous_event_id": previous[-1]["id"] if previous else None,
        "started_at": started_at,
        "duration_ms": round(duration_ms, 3),
        "case_id": case_root.name,
        "stage": "design_system_wireframe",
        "mode": session.get("mode", "unrecorded"),
        "model": session.get("model", "unrecorded"),
        "command": "wireframe-" + command,
        "outcome": "error" if error else "success",
        "decision_id": decision_id,
        "before": {},
        "after": {},
        "error": error,
        "details": {
            "tool": receipt["tool"],
            "tool_outcome": "error" if error else "success",
            "receipt_ref": "evidence/tool-events.jsonl#" + receipt_id,
            "run_id": run_id or "",
            "target_id": target_id or "",
        },
        "versions": {},
        "prior_session_entries": len(session.get("entries", [])),
    })


def run_engine(command, run_dir=None, packet_path=None, output_root=None, run_id=None, parent_run_id=None, retry_stage=None, case_root=None, target_id=None):
    args = ["node", str(ENGINE_CLI), command]
    if command == "prepare":
        args += ["--input", str(packet_path), "--output-root", str(output_root), "--pack-root", str(PACK_ROOT)]
        if run_id:
            args += ["--run-id", run_id]
        if parent_run_id:
            args += ["--parent-run-id", parent_run_id]
        if retry_stage:
            args += ["--retry-stage", retry_stage]
    else:
        args += ["--run-dir", str(run_dir)]
    cwd = PLUGIN_ROOT / "design-pipeline"
    started_at = now()
    started = time.perf_counter()
    proc = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    duration_ms = (time.perf_counter() - started) * 1000
    result = None
    resolved_run_dir = run_dir
    if proc.returncode != 0:
        try:
            write_engine_manifest(command, args, cwd, started_at, duration_ms, proc, {}, resolved_run_dir)
        finally:
            record_common_engine_event(case_root, command, target_id, Path(run_dir).name if run_dir else run_id, None, started_at, duration_ms, (proc.stderr or proc.stdout).strip())
        raise ValueError((proc.stderr or proc.stdout).strip())
    result = json.loads(proc.stdout)
    if command == "prepare":
        resolved_run_dir = result.get("runDir")
    result_run_id = result.get("runId") if isinstance(result, dict) and result.get("runId") else Path(resolved_run_dir).name if resolved_run_dir else run_id
    write_engine_manifest(command, args, cwd, started_at, duration_ms, proc, result, resolved_run_dir)
    record_common_engine_event(case_root, command, target_id, result_run_id, result, started_at, duration_ms)
    return result


def target_record_id(screen_id):
    return "target-" + screen_id


def required_coverage(brief, source):
    screen_id = brief["screen_id"]
    elements = {row["id"] for row in source["elements"] if row["screen_id"] == screen_id}
    scopes = elements | {screen_id}
    return {
        "screen_ids": [screen_id],
        "element_ids": sorted(elements),
        "state_axis_ids": sorted(row["id"] for row in source["state_axes"] if row["scope_id"] in scopes),
        "transition_ids": sorted(row["transition_id"] for row in brief["flows"]),
        "render_case_ids": sorted(row["render_case_id"] for row in brief["states"]),
        "design_handoff_ids": sorted(row["handoff_id"] for row in brief["design_handoffs"]),
    }


def empty_decisions():
    return {
        stage: {"status": "pending", "rationale": "", "evidence_ids": []}
        for stage in design_system_wireframe.REQUIRED_DECISION_STAGES
    }


def initial_target(case_root, brief, source, knowledge_binding, prepared, parent_run_id, retry_stage):
    run_dir = Path(prepared["runDir"])
    atomic_json(run_dir / "brief.json", brief)
    trace_template = run_dir / "traceability.template.json"
    wire_dir = Path(case_root) / "wireframes" / brief["screen_id"]
    atomic_json(wire_dir / "traceability.json", load_json(trace_template))
    required = required_coverage(brief, source)
    input_refs = sorted({item for values in required.values() for item in values})
    packet = load_json(run_dir / "packet.json")
    return {
        "id": target_record_id(brief["screen_id"]),
        "screen_id": brief["screen_id"],
        "status": "draft",
        "input_refs": input_refs,
        "required_coverage": required,
        "run_id": prepared["runId"],
        "parent_run_id": parent_run_id,
        "retry_stages": [retry_stage or "roles"],
        "brief_path": rel(case_root, run_dir / "brief.json"),
        "packet_path": rel(case_root, run_dir / "packet.json"),
        "spec_path": rel(case_root, run_dir / "design-spec.template.json"),
        "renderer_path": rel(case_root, run_dir / "renderer/index.html"),
        "artifact_hashes": {
            "brief": design_system_wireframe.file_hash(run_dir / "brief.json"),
            "packet": design_system_wireframe.file_hash(run_dir / "packet.json"),
            "spec": design_system_wireframe.file_hash(run_dir / "design-spec.template.json"),
            "renderer": design_system_wireframe.file_hash(run_dir / "renderer/index.html"),
        },
        "detail_mode": "inline",
        "detail_artifact": {"path": rel(case_root, Path(case_root) / "evidence/canonical-details" / (run_dir.name + ".json")), "hash": "0" * 64},
        "design_decisions": empty_decisions(),
        "state_mappings": [],
        "transition_assertions": [],
        "component_mappings": [],
        "token_mappings": [],
        "runtime_checks": [],
        "captures": [],
        "gate": {
            "verdict": "revise",
            "rationale": "Engine prepared one immutable run; authored renderer, runtime, captures, and W1-W7 review are pending.",
            "review_id": "review-" + target_record_id(brief["screen_id"]),
            "input_hash": packet["source"]["content_hash"],
            "knowledge_hash": knowledge_binding["content_hash"],
            "artifact_hashes": {"spec": "", "renderer": "", "runtime": []},
            "artifacts": {
                "decisions": {"path": rel(case_root, run_dir / "design-decisions.json"), "hash": ""},
                "capture": {"path": rel(case_root, run_dir / "runtime.json"), "hash": ""},
                "review": {"path": rel(case_root, run_dir / "ai-review.json"), "hash": ""},
                "result": {"path": rel(case_root, run_dir / "gate.json"), "hash": ""},
            },
            "capture_hashes": [],
            "blocking_issue_ids": [],
            "retry_stage": retry_stage or "roles",
        },
    }


def prepare_stage_inputs(case_root, source_path, source, knowledge_binding, previous_targets=None):
    adapted = wireframe_adapter.adapt_screen_behavior(source, source_path, knowledge_binding)
    previous_by_screen = {target["screen_id"]: target for target in previous_targets or []}
    targets = []
    coverage = []
    output_root = Path(case_root) / "evidence/design-runs"
    for brief in adapted["targets"]:
        packet = dict(adapted)
        packet["targets"] = [brief]
        packet_path = output_root / ".prepare" / (brief["target_id"] + ".packet.json")
        atomic_json(packet_path, packet)
        parent_run_id = previous_by_screen.get(brief["screen_id"], {}).get("run_id", "")
        retry_stage = "capture" if parent_run_id else ""
        prepared = run_engine("prepare", packet_path=packet_path, output_root=output_root,
                              parent_run_id=parent_run_id, retry_stage=retry_stage,
                              case_root=case_root, target_id=target_record_id(brief["screen_id"]))
        target = initial_target(case_root, brief, source, knowledge_binding, prepared, parent_run_id, retry_stage)
        targets.append(target)
        for kind, field in design_system_wireframe.COVERAGE_FIELD_BY_KIND.items():
            for source_id in target["required_coverage"][field]:
                coverage.append({"target_id": target["id"], "kind": kind, "source_id": source_id,
                                 "status": "gap", "evidence_ids": [], "issue_ids": []})
    target_ids = {row["id"] for row in targets}
    navigation_links = []
    for link in adapted["cross_screen_links"]:
        source_ids = [target_record_id(row) for row in link.get("source_screen_ids", [])]
        dest_ids = [target_record_id(row) for row in link.get("destination_screen_ids", [])]
        for from_id in source_ids:
            for to_id in dest_ids:
                if from_id in target_ids and to_id in target_ids:
                    navigation_links.append({"id": "nav-" + link["transition_id"] + "-" + from_id + "-" + to_id,
                                             "from_target_id": from_id, "to_target_id": to_id,
                                             "trigger_ref": link["transition_id"], "status": "pending"})
    return targets, coverage, navigation_links


def select_targets(record, target_id):
    if target_id:
        selected = [target for target in record["targets"] if target["id"] == target_id or target["screen_id"] == target_id]
        if not selected:
            raise ValueError("unknown target_id " + target_id)
        return selected
    return record["targets"]


def assert_run_dir(case_root, record, target):
    run_id = target.get("run_id", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{7,80}", run_id):
        raise ValueError("opaque run id required")
    root = (Path(case_root) / "evidence/design-runs").resolve()
    run_dir = (root / run_id).resolve()
    try:
        run_dir.relative_to(root)
    except ValueError as exc:
        raise ValueError("run directory must remain inside case evidence/design-runs") from exc
    meta = load_json(run_dir / "run.json")
    status_path = run_dir / "status.json"
    status = load_json(status_path) if status_path.exists() else {}
    packet = load_json(run_dir / "packet.json")
    if meta.get("runId") != run_id:
        raise ValueError("run record identity mismatch")
    if meta.get("parentRunId") == run_id or status.get("parentRunId") == run_id:
        raise ValueError("parent run id cannot equal run id")
    if status.get("runId") and status.get("runId") != run_id:
        raise ValueError("run status identity mismatch")
    if status.get("parentRunId", meta.get("parentRunId", "")) != meta.get("parentRunId", ""):
        raise ValueError("run status parent mismatch")
    if status.get("retryStage", meta.get("retryStage", "")) != meta.get("retryStage", ""):
        raise ValueError("run status retry stage mismatch")
    if meta.get("packet", {}).get("source", {}).get("content_hash") != record["input_binding"]["screen_behavior"]["content_hash"]:
        raise ValueError("engine run source is stale")
    targets = packet.get("targets", [])
    if len(targets) != 1 or targets[0].get("screen_id") != target.get("screen_id"):
        raise ValueError("engine run target identity mismatch")
    return run_dir



def accepted_parent_run_dir_for_unfinished_retry(case_root, record, target, run_dir):
    if (run_dir / "gate.json").exists():
        return None
    meta = load_json(run_dir / "run.json")
    parent_id = meta.get("parentRunId") or ""
    if not parent_id:
        return None
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{7,80}", parent_id):
        raise ValueError("opaque parent run id required")
    root = (Path(case_root) / "evidence/design-runs").resolve()
    parent_dir = (root / parent_id).resolve()
    try:
        parent_dir.relative_to(root)
    except ValueError as exc:
        raise ValueError("run directory must remain inside case evidence/design-runs") from exc
    if not parent_dir.exists() or not (parent_dir / "gate.json").exists():
        return None
    parent_gate = load_json(parent_dir / "gate.json")
    if parent_gate.get("verdict") != "accept_ai":
        return None
    parent_target = dict(target)
    parent_target["run_id"] = parent_id
    parent_run_dir = assert_run_dir(case_root, record, parent_target)
    current_brief = load_json(run_dir / "brief.json") if (run_dir / "brief.json").exists() else {}
    parent_brief = load_json(parent_run_dir / "brief.json") if (parent_run_dir / "brief.json").exists() else {}
    if current_brief.get("screen_id") and parent_brief.get("screen_id") and current_brief.get("screen_id") != parent_brief.get("screen_id"):
        raise ValueError("retry parent screen mismatch")
    return parent_run_dir


def command_record_path(case_root):
    return Path(case_root) / "design-system-wireframe.json"


def semantic_record_hash(record):
    semantic = {key: value for key, value in record.items() if key != "history"}
    return design_system_wireframe.digest(semantic)


def command_artifact_ref(case_root, run_dir, command):
    path = Path(run_dir) / (command + "-command.json")
    return rel(case_root, path) if path.exists() else ""


def runtime_capture_ids(runtime):
    return {row["renderCaseId"] + "-" + row["viewport"] for row in runtime.get("captures", [])}


def runtime_transition_evidence_ids(runtime):
    ids = set()
    for row in runtime.get("transitionEvidence", []):
        if row.get("evidenceId"):
            ids.add(row["evidenceId"])
        if row.get("runtimeCheckId"):
            ids.add(row["runtimeCheckId"])
    return ids


def validate_authored_decisions(record, target, run_dir, require_frozen=False):
    path = run_dir / "design-decisions.json"
    if not path.exists():
        raise ValueError("design-decisions.json is required before freeze/sync")
    decisions = load_json(path)
    packet_target_id = load_json(run_dir / "packet.json")["targets"][0]["target_id"]
    if decisions.get("target_id") != packet_target_id:
        raise ValueError("design-decisions target_id mismatch")
    if decisions.get("input_hash") != record["input_binding"]["screen_behavior"]["content_hash"]:
        raise ValueError("design-decisions input_hash is stale")
    if decisions.get("knowledge_hash") != record["knowledge_binding"]["content_hash"]:
        raise ValueError("design-decisions knowledge_hash is stale")
    runtime = load_json(run_dir / "runtime.json")
    evidence = runtime_capture_ids(runtime) | runtime_transition_evidence_ids(runtime) | {"runtime-playwright", "ai-review"}
    authored = decisions.get("stages", {})
    missing = sorted(set(design_system_wireframe.REQUIRED_DECISION_STAGES) - set(authored))
    if missing:
        raise ValueError("design-decisions missing stages: " + ", ".join(missing))
    for stage in design_system_wireframe.REQUIRED_DECISION_STAGES:
        row = authored.get(stage, {})
        if row.get("status") != "verified":
            raise ValueError("design-decisions " + stage + " must be verified")
        if not str(row.get("rationale", "")).strip():
            raise ValueError("design-decisions " + stage + " rationale required")
        ids = row.get("evidence", [])
        if not isinstance(ids, list) or not ids:
            raise ValueError("design-decisions " + stage + " evidence_ids required")
        unknown = sorted(set(ids) - evidence)
        if unknown:
            raise ValueError("design-decisions " + stage + " unknown evidence: " + ", ".join(unknown))
    if require_frozen:
        freeze = load_json(run_dir / "freeze.json")
        frozen = freeze.get("artifacts", {}).get("design-decisions.json", {})
        if frozen.get("sha256") != design_system_wireframe.file_hash(path):
            raise ValueError("design-decisions.json frozen hash missing or stale")
    return decisions


def frozen_artifact_issues(run_dir):
    if not (run_dir / "freeze.json").exists():
        return ["freeze.json is required before sync"]
    freeze = load_json(run_dir / "freeze.json")
    issues = []
    for path, artifact in freeze.get("artifacts", {}).items():
        artifact_path = run_dir / path
        if not artifact_path.exists():
            issues.append(path + ": frozen artifact missing")
        elif design_system_wireframe.file_hash(artifact_path) != artifact.get("sha256"):
            issues.append(path + ": frozen hash mismatch")
    return issues


def canonical_decisions(decisions):
    return {
        stage: {
            "status": decisions["stages"][stage]["status"],
            "rationale": decisions["stages"][stage]["rationale"],
            "evidence_ids": list(decisions["stages"][stage]["evidence"]),
        }
        for stage in design_system_wireframe.REQUIRED_DECISION_STAGES
    }


def freeze_target(case_root, record, target):
    run_dir = assert_run_dir(case_root, record, target)
    validate_authored_decisions(record, target, run_dir)
    result = run_engine("freeze", run_dir=run_dir, case_root=case_root, target_id=target["id"])
    freeze_path = run_dir / "freeze.json"
    freeze = load_json(freeze_path)
    freeze.setdefault("artifacts", {})["design-decisions.json"] = {"sha256": design_system_wireframe.file_hash(run_dir / "design-decisions.json")}
    atomic_json(freeze_path, freeze)
    return freeze


def engine_command(case_root, command, target_id=None):
    record = load_json(command_record_path(case_root))
    results = []
    for target in select_targets(record, target_id):
        run_dir = assert_run_dir(case_root, record, target)
        if command in ("spec", "runtime", "freeze", "gate"):
            validate_renderer_run_refs(case_root, record, target)
        engine = freeze_target(case_root, record, target) if command == "freeze" else run_engine(command, run_dir=run_dir, case_root=case_root, target_id=target["id"])
        results.append({
            "target_id": target["id"],
            "screen_id": target["screen_id"],
            "run_id": Path(run_dir).name,
            "summary": summarize_engine_result(command, engine),
            "artifacts": {"command": command_artifact_ref(case_root, run_dir, command)},
        })
    return {"case_path": str(Path(case_root).resolve()), "command": command, "target_results": results}


def validate_engine_current(case_root, record, target, run_dir, gate):
    issues = []
    meta = load_json(run_dir / "run.json")
    packet = load_json(run_dir / "packet.json")
    if meta["runId"] != target["run_id"]:
        issues.append("run id mismatch")
    if packet["source"]["content_hash"] != record["input_binding"]["screen_behavior"]["content_hash"]:
        issues.append("packet source is stale")
    if target["gate"]["knowledge_hash"] != record["knowledge_binding"]["content_hash"]:
        issues.append("target knowledge hash is stale")
    review_path = run_dir / "ai-review.json"
    if not review_path.exists():
        issues.append("AI review is missing")
        return issues, None
    review = load_json(review_path)
    runtime = load_json(run_dir / "runtime.json") if (run_dir / "runtime.json").exists() else {"captures": []}
    capture_hashes = [row["imageHash"] for row in runtime.get("captures", [])]
    if review.get("input_hash") != record["input_binding"]["screen_behavior"]["content_hash"]:
        issues.append("AI review input hash is stale")
    if review.get("knowledge_hash") != record["knowledge_binding"]["content_hash"]:
        issues.append("AI review knowledge hash is stale")
    if Counter(review.get("capture_hashes", [])) != Counter(capture_hashes):
        issues.append("AI review capture hashes are stale")
    criteria_ids = {item.get("id") for item in review.get("criteria", []) if isinstance(item, dict)}
    missing = sorted(set(design_system_wireframe.CRITERIA) - criteria_ids)
    if missing:
        issues.append("AI review missing criteria " + ", ".join(missing))
    if gate.get("verdict") != "accept_ai" and not (
        gate.get("verdict") == "insufficient_evidence"
        and not gate.get("errors")
        and review.get("verdict") == "accept_ai"
    ):
        issues.append("gate verdict is " + gate.get("verdict", "missing"))
    return issues, review


def selected_reference_rationale(review):
    if not isinstance(review, dict):
        return ""
    summaries = []
    for row in review.get("viewed_references", []):
        if not isinstance(row, dict):
            continue
        ref_id = row.get("id") or row.get("path")
        observations = "; ".join(item for item in row.get("observations", []) if isinstance(item, str) and item.strip())
        transferred = "; ".join(item for item in row.get("transferredFeatures", []) if isinstance(item, str) and item.strip())
        excluded = "; ".join(item for item in row.get("excludedFeatures", []) if isinstance(item, str) and item.strip())
        if ref_id and observations and transferred and excluded:
            summaries.append(f"{ref_id}: observed {observations}; transferred {transferred}; excluded {excluded}")
    return " Selected references reviewed: " + " | ".join(summaries) if summaries else ""


def synced_token_mappings(pack, token_mappings):
    resolved, errors = design_tokens.resolve_token_map(pack)
    rows = []
    for row in token_mappings:
        token = row["token"]
        if token not in resolved:
            errors.append("missing token reference " + token)
            continue
        rows.append({
            "semantic_token": token,
            "value": resolved[token],
            "knowledge_ref": "token:" + token,
            "applied_to": row["appliedTo"],
        })
    return rows, errors


def component_interface_ref(pack, mapping):
    if mapping.get("interface") and mapping.get("interfaceFile"):
        return mapping["interfaceFile"] + "#" + mapping["interface"]
    for row in pack.get("componentKnowledge", []):
        if row.get("ref") != mapping.get("knowledgeRef"):
            continue
        interface = row.get("interface")
        if isinstance(interface, dict) and interface.get("file") and interface.get("interface"):
            return interface["file"] + "#" + interface["interface"]
        break
    return mapping["component"]


def canonical_preserved_value(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        scope = value.get("scope_id", "")
        item = value.get("item_ref")
        axis = value.get("axis_id", "")
        state = value.get("value_id", "")
        target = scope + (":" + str(item) if item else "")
        return target + ":" + axis + "=" + state if target and axis and state else json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def canonical_guard(transition_id, authored, brief):
    guard = str(authored.get("guard", ""))
    flow = next((row for row in brief.get("flows", []) if row.get("transition_id") == transition_id), {})
    preconditions = [str(row) for row in flow.get("preconditions", []) if str(row).strip()]
    if guard in preconditions:
        return guard
    for precondition in preconditions:
        if guard.startswith(precondition) or precondition in guard:
            return precondition
    return guard


def flattened_state_assertions(spec, render_case_id, runtime_check_id, assignment=None, screen_source=None):
    assertions = []
    nodes = spec.get("nodes", {})
    case_assertions = spec.get("stateAssertions", {}).get(render_case_id, {})
    required_properties = set()
    scoped_node = ""
    scoped_item = None
    if assignment:
        required_properties = set(design_system_wireframe.required_state_properties(screen_source, assignment.get("axis_id", "")))
        scoped_node = assignment.get("scope_id", "") if assignment.get("scope_id", "") in case_assertions else ""
        scoped_item = assignment.get("item_ref")
    for node_id in sorted(case_assertions):
        if scoped_node and node_id != scoped_node:
            continue
        entry = case_assertions[node_id]
        rows = entry if isinstance(entry, list) else [{"item_ref": None, "selector": nodes.get(node_id, {}).get("selector", ""), "states": entry}]
        for row in rows:
            row_item = row.get("item_ref", row.get("itemRef"))
            if scoped_item in (None, "") and row_item not in (None, ""):
                continue
            if scoped_item is not None and row_item not in (None, "", scoped_item, "item", "clicked"):
                continue
            selector = row.get("selector") or nodes.get(node_id, {}).get("selector", "")
            states = row.get("states", row.get("assertions", {}))
            if not isinstance(states, dict):
                continue
            for prop, expected in sorted(states.items()):
                if required_properties and prop not in required_properties:
                    continue
                if prop in design_system_wireframe.STATE_PROPERTIES and isinstance(expected, (bool, str)):
                    assertions.append({
                        "property": prop,
                        "expected": expected,
                        "selector": selector,
                        "runtime_check_id": runtime_check_id,
                    })
    if assertions or not scoped_node:
        return assertions
    return flattened_state_assertions(spec, render_case_id, runtime_check_id)


def assignment_matches(effect, assignment):
    if effect.get("scope_id") != assignment.get("scope_id"):
        return False
    if effect.get("axis_id") != assignment.get("axis_id"):
        return False
    if effect.get("value_id") != assignment.get("value_id"):
        return False
    effect_item = effect.get("item_ref")
    assignment_item = assignment.get("item_ref")
    return effect_item in (None, "", assignment_item, "item", "clicked") or assignment_item in (None, "", effect_item)


def render_state_mappings(brief, spec, runtime_check_id, captures, screen_source):
    capture_by_case = {row["render_case_id"]: row["id"] for row in captures}
    rows = []
    seen = set()

    def add(case_id, assignment, transition_id):
        item_ref = assignment.get("item_ref")
        key = (case_id, item_ref, assignment["axis_id"])
        if key in seen:
            return
        seen.add(key)
        assertions = flattened_state_assertions(spec, case_id, runtime_check_id, assignment, screen_source)
        item_suffix = "-" + str(item_ref).replace("/", "-") if item_ref not in (None, "") else ""
        rows.append({
            "render_case_id": case_id,
            "item_ref": item_ref,
            "state_axis_id": assignment["axis_id"],
            "transition_id": transition_id,
            "design_state_id": case_id + item_suffix + "-" + assignment["axis_id"] + "-" + transition_id,
            "state_assertions": assertions,
            "capture_id": capture_by_case.get(case_id, ""),
        })

    flows = brief.get("flows", [])
    for state in brief.get("states", []):
        case_id = state["render_case_id"]
        scenario_ids = set(state.get("scenario_ids", []))
        candidate_flows = [
            flow for flow in flows
            if not scenario_ids or not flow.get("scenario_ids") or scenario_ids & set(flow.get("scenario_ids", []))
        ]
        for assignment in state.get("state_assignments", []):
            effects_by_flow = [
                (
                    flow,
                    list(flow.get("before", []) or [])
                    + list(flow.get("after", []) or [])
                    + list(flow.get("preserved_values", []) or []),
                )
                for flow in candidate_flows
            ]
            transition = next(
                (flow["transition_id"] for flow, effects in effects_by_flow
                 if any(assignment_matches(effect, assignment) for effect in effects)),
                candidate_flows[0]["transition_id"] if candidate_flows else "",
            )
            if transition:
                add(case_id, assignment, transition)
    return rows


def preserved_value_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        scope = value.get("scope_id", "")
        item = value.get("item_ref")
        axis = value.get("axis_id", "")
        state = value.get("value_id", "")
        item_text = "[" + str(item) + "]" if item not in (None, "") else ""
        if scope and axis and state:
            return f"{scope}{item_text}:{axis}={state}"
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def transition_evidence_by_id(runtime):
    rows = {}
    for row in runtime.get("transitionEvidence", []):
        transition_id = row.get("transitionId")
        if transition_id and transition_id not in rows:
            rows[transition_id] = row
    return rows


def renderer_run_refs(case_root, target):
    run_id = target.get("run_id", "")
    if not run_id:
        return set(), False
    renderer_dir = Path(case_root) / "evidence/design-runs" / run_id / "renderer"
    if not renderer_dir.exists():
        return set(), False
    refs = set()
    for path in sorted(renderer_dir.rglob("*")):
        if path.suffix not in (".html", ".js", ".css"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeError:
            continue
        refs.update(re.findall(r"run-[a-z0-9][a-z0-9-]{6,80}", text))
    return refs, True


def validate_renderer_run_refs(case_root, record, target):
    refs, renderer_exists = renderer_run_refs(case_root, target)
    if not renderer_exists or not refs:
        return
    current = {row.get("run_id") for row in record.get("targets", []) if row.get("run_id")}
    stale = sorted(refs - current)
    if stale:
        raise ValueError("superseded renderer run reference: " + ", ".join(stale))


def validate_transition_evidence(target, runtime, spec):
    issues = []
    required = set(target["required_coverage"]["transition_ids"])
    authored = spec.get("transitionAssertions", {})
    evidence = transition_evidence_by_id(runtime)
    if set(authored) != required:
        missing = sorted(required - set(authored))
        extra = sorted(set(authored) - required)
        if missing:
            issues.append("transition assertions missing: " + ", ".join(missing))
        if extra:
            issues.append("transition assertions extra: " + ", ".join(extra))
    if set(evidence) != required:
        missing = sorted(required - set(evidence))
        extra = sorted(set(evidence) - required)
        if missing:
            issues.append("transition evidence missing: " + ", ".join(missing))
        if extra:
            issues.append("transition evidence extra: " + ", ".join(extra))
    for transition_id in sorted(required & set(evidence)):
        if evidence[transition_id].get("status") != "pass" and evidence[transition_id].get("pass") is not True:
            issues.append("transition evidence failed: " + transition_id)
    return issues, evidence


def sync_target(case_root, record, target):
    run_dir = assert_run_dir(case_root, record, target)
    fallback_run_dir = accepted_parent_run_dir_for_unfinished_retry(case_root, record, target, run_dir)
    if fallback_run_dir is not None:
        run_dir = fallback_run_dir
        target["run_id"] = run_dir.name
    meta = load_json(run_dir / "run.json")
    target["parent_run_id"] = meta.get("parentRunId", "")
    gate = load_json(run_dir / "gate.json") if (run_dir / "gate.json").exists() else {"verdict": "insufficient_evidence", "errors": ["gate missing"], "retryStage": "gate"}
    issues, review = validate_engine_current(case_root, record, target, run_dir, gate)
    issues.extend(frozen_artifact_issues(run_dir))
    try:
        decisions = validate_authored_decisions(record, target, run_dir, require_frozen=True)
    except ValueError as exc:
        issues.append(str(exc))
        decisions = None
    runtime = load_json(run_dir / "runtime.json") if (run_dir / "runtime.json").exists() else {"captures": []}
    spec_validation = load_json(run_dir / "spec-validation.json") if (run_dir / "spec-validation.json").exists() else {}
    spec_path = run_dir / ("design-spec.json" if (run_dir / "design-spec.json").exists() else "design-spec.template.json")
    spec = load_json(spec_path) if spec_path.exists() else {}
    transition_issues, transition_evidence = validate_transition_evidence(target, runtime, spec)
    issues.extend(transition_issues)
    trace_path = run_dir / ("traceability.json" if (run_dir / "traceability.json").exists() else "traceability.template.json")
    renderer_path = run_dir / "renderer/index.html"

    target["spec_path"] = rel(case_root, spec_path)
    target["renderer_path"] = rel(case_root, renderer_path)
    target["artifact_hashes"].update({
        "brief": design_system_wireframe.file_hash(Path(case_root) / target["brief_path"]),
        "packet": design_system_wireframe.file_hash(run_dir / "packet.json"),
        "spec": design_system_wireframe.file_hash(spec_path),
        "renderer": design_system_wireframe.file_hash(renderer_path),
    })
    runtime_hash = design_system_wireframe.file_hash(run_dir / "runtime.json") if (run_dir / "runtime.json").exists() else ""
    target["runtime_checks"] = [{
        "id": "runtime-playwright",
        "status": "pass" if runtime.get("pass") is True else "fail",
        "evidence_path": rel(case_root, run_dir / "runtime.json"),
        "source_hash": runtime_hash,
    }]
    for transition_id in sorted(transition_evidence):
        row = transition_evidence[transition_id]
        check_id = row.get("runtimeCheckId") or "transition-" + transition_id
        transition_checks = [check_id]
        if row.get("evidenceId") and row["evidenceId"] not in transition_checks:
            transition_checks.append(row["evidenceId"])
        for evidence_id in transition_checks:
            target["runtime_checks"].append({
                "id": evidence_id,
                "status": "pass" if row.get("status") == "pass" or row.get("pass") is True else "fail",
                "evidence_path": rel(case_root, run_dir / "runtime.json"),
                "source_hash": runtime_hash,
            })
    target["captures"] = [{
        "id": row["renderCaseId"] + "-" + row["viewport"],
        "render_case_id": row["renderCaseId"],
        "viewport": row["viewport"],
        "state": row["renderCaseId"],
        "path": rel(case_root, run_dir / row["path"]),
        "image_hash": row["imageHash"],
        "source_hash": target["artifact_hashes"]["renderer"],
    } for row in runtime.get("captures", [])]
    if decisions and not issues:
        target["design_decisions"] = canonical_decisions(decisions)
    pack = load_json(PACK_ROOT / record["knowledge_binding"]["pack_id"] / record["knowledge_binding"]["version"] / "pack.json")
    component_rows = []
    for row in spec_validation.get("componentMappings", []):
        component_rows.append({
            "element_id": row["elementId"],
            "hds_component": row["component"],
            "interface": component_interface_ref(pack, row),
            "props": row.get("props") or {},
            "version": record["knowledge_binding"]["version"],
            "knowledge_ref": row["knowledgeRef"],
        })
    target["component_mappings"] = component_rows
    target["token_mappings"], token_issues = synced_token_mappings(pack, spec_validation.get("tokenMappings", []))
    issues.extend(token_issues)
    runtime_check_id = target["runtime_checks"][0]["id"] if target["runtime_checks"] else ""
    captures = target["captures"]
    brief = load_json(run_dir / "brief.json")
    screen_source = load_json(Path(case_root) / record["input_binding"]["screen_behavior"]["path"])
    state_mappings = render_state_mappings(brief, spec, runtime_check_id, captures, screen_source)
    transition_assertions = spec.get("transitionAssertions", {})
    transitions = target["required_coverage"]["transition_ids"]
    target["transition_assertions"] = [{
        "transition_id": tid,
        "trigger": transition_assertions.get(tid, {}).get("trigger", ""),
        "guard": canonical_guard(tid, transition_assertions.get(tid, {}), brief),
        "observable_result": transition_assertions.get(tid, {}).get("observable_result", ""),
        "preserved_values": [canonical_preserved_value(value) for value in transition_assertions.get(tid, {}).get("preserved_values", [])],
        "focus_result": transition_assertions.get(tid, {}).get("focus_result", ""),
        "runtime_check_id": transition_evidence.get(tid, {}).get("runtimeCheckId") or ("transition-" + tid if tid in transition_evidence else ""),
    } for tid in transitions]
    details = {
        "schema_version": 1,
        "target_id": target["id"],
        "screen_id": target["screen_id"],
        "run_id": run_dir.name,
        "input_hash": record["input_binding"]["screen_behavior"]["content_hash"],
        "knowledge_hash": record["knowledge_binding"]["content_hash"],
        "artifact_hashes": {
            "spec": target["artifact_hashes"]["spec"],
            "renderer": target["artifact_hashes"]["renderer"],
            "runtime": runtime_hash,
        },
        "state_mappings": state_mappings,
        "component_mappings": component_rows,
        "token_mappings": target["token_mappings"],
    }
    detail_path = Path(case_root) / "evidence/canonical-details" / (run_dir.name + ".json")
    atomic_json_if_changed(detail_path, details)
    target["detail_mode"] = "artifact"
    target["detail_artifact"] = {"path": rel(case_root, detail_path), "hash": design_system_wireframe.file_hash(detail_path)}
    target["state_mappings"] = []
    target["component_mappings"] = []
    target["token_mappings"] = []
    verdict = gate.get("verdict", "invalid")
    if verdict == "insufficient_evidence" and not issues and review and review.get("verdict") == "accept_ai":
        verdict = "accept_ai"
    if issues:
        verdict = "invalid" if verdict == "accept_ai" else verdict
    accepted_rationale = "Engine gate accepted current Playwright captures and W1-W7 AI review." + selected_reference_rationale(review)
    target["status"] = verdict
    target["retry_stages"] = [] if verdict == "accept_ai" and not issues else [gate.get("retryStage") or gate.get("retryStage", "") or gate.get("retry_stage", "") or "review"]
    target["gate"].update({
        "verdict": verdict,
        "rationale": accepted_rationale if verdict == "accept_ai" and not issues else "; ".join(issues or gate.get("errors", []) or ["engine gate did not accept"]),
        "review_id": "ai-review",
        "input_hash": record["input_binding"]["screen_behavior"]["content_hash"],
        "knowledge_hash": record["knowledge_binding"]["content_hash"],
        "artifact_hashes": {
            "spec": target["artifact_hashes"]["spec"],
            "renderer": target["artifact_hashes"]["renderer"],
            "runtime": [row["source_hash"] for row in target["runtime_checks"]],
        },
        "artifacts": {
            "decisions": {"path": rel(case_root, run_dir / "design-decisions.json"), "hash": design_system_wireframe.file_hash(run_dir / "design-decisions.json") if (run_dir / "design-decisions.json").exists() else ""},
            "capture": {"path": rel(case_root, run_dir / "runtime.json"), "hash": design_system_wireframe.file_hash(run_dir / "runtime.json") if (run_dir / "runtime.json").exists() else ""},
            "review": {"path": rel(case_root, run_dir / "ai-review.json"), "hash": design_system_wireframe.file_hash(run_dir / "ai-review.json") if (run_dir / "ai-review.json").exists() else ""},
            "result": {"path": rel(case_root, run_dir / "gate.json"), "hash": design_system_wireframe.file_hash(run_dir / "gate.json") if (run_dir / "gate.json").exists() else ""},
        },
        "capture_hashes": [row["image_hash"] for row in target["captures"]],
        "blocking_issue_ids": [],
        "retry_stage": "" if verdict == "accept_ai" and not issues else target["retry_stages"][0],
    })
    return {"target_id": target["id"], "verdict": verdict, "issues": issues}


def sync_navigation_links(record, case_root=None):
    targets = {target["id"]: target for target in record.get("targets", [])}
    current_run_ids = {target.get("run_id", "") for target in record.get("targets", []) if target.get("run_id")}
    for link in record.get("navigation_links", []):
        source = targets.get(link.get("from_target_id"))
        destination = targets.get(link.get("to_target_id"))
        passing_transitions = {
            row.get("transition_id")
            for row in (source or {}).get("transition_assertions", [])
            if row.get("runtime_check_id")
        }
        passing_triggers = set(passing_transitions)
        if case_root and source and source.get("brief_path"):
            brief = load_json(Path(case_root) / source["brief_path"])
            for flow in brief.get("flows", []):
                if flow.get("transition_id") in passing_transitions:
                    passing_triggers.update(flow.get("parent_transition_refs", []))
        targets_accepted = (
            source and destination
            and source.get("status") == "accept_ai"
            and destination.get("status") == "accept_ai"
        )
        trigger_verified = link.get("trigger_ref") in passing_triggers
        renderer_verified = True
        if case_root and source and destination and source.get("id") != destination.get("id"):
            refs, renderer_exists = renderer_run_refs(case_root, source)
            if renderer_exists and refs:
                stale_refs = refs - current_run_ids
                renderer_verified = not stale_refs and destination.get("run_id") in refs
        link["status"] = "verified" if targets_accepted and trigger_verified and renderer_verified else "broken"


def precise_coverage_evidence(target, details):
    by_kind = {
        "screen": {},
        "element": {},
        "state_axis": {},
        "transition": {},
        "render_case": {},
        "design_handoff": {},
    }
    for screen_id in target["required_coverage"]["screen_ids"]:
        by_kind["screen"][screen_id] = ["runtime-playwright"]
    for element_id in target["required_coverage"]["element_ids"]:
        by_kind["element"][element_id] = ["runtime-playwright"]
    for assertion in target["transition_assertions"]:
        if assertion.get("runtime_check_id"):
            by_kind["transition"][assertion["transition_id"]] = [assertion["runtime_check_id"]]
    for capture in target["captures"]:
        by_kind["render_case"].setdefault(capture["render_case_id"], []).append(capture["id"])
    for mapping in details.get("state_mappings", []):
        ids = [row["runtime_check_id"] for row in mapping.get("state_assertions", []) if row.get("runtime_check_id")]
        by_kind["state_axis"].setdefault(mapping["state_axis_id"], [])
        by_kind["state_axis"][mapping["state_axis_id"]].extend(ids or ["runtime-playwright"])
    for handoff_id in target["required_coverage"]["design_handoff_ids"]:
        by_kind["design_handoff"][handoff_id] = ["ai-review"]
    return {
        kind: {source_id: sorted(set(ids)) for source_id, ids in rows.items()}
        for kind, rows in by_kind.items()
    }


def sync(case_root, target_id=None):
    started_at = now()
    started = time.perf_counter()
    try:
        return _sync(case_root, target_id, started_at, started)
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        record_common_engine_event(
            case_root, "sync", target_id, "", None, started_at,
            (time.perf_counter() - started) * 1000, str(exc),
        )
        raise


def _sync(case_root, target_id, started_at, started):
    record_path = command_record_path(case_root)
    record = load_json(record_path)
    before_semantic_hash = semantic_record_hash(record)
    results = [sync_target(case_root, record, target) for target in select_targets(record, target_id)]
    accepted = all(target["status"] == "accept_ai" for target in record["targets"])
    evidence_by_target = {}
    review_criteria = []
    review_evidence = []
    review_rationales = []
    for target in record["targets"]:
        detail_path = Path(case_root) / target["detail_artifact"]["path"]
        details = load_json(detail_path) if target.get("detail_mode") == "artifact" and detail_path.exists() else {
            "state_mappings": target.get("state_mappings", []),
        }
        evidence_by_target[target["id"]] = precise_coverage_evidence(target, details)
        review_path = Path(case_root) / "evidence/design-runs" / target["run_id"] / "ai-review.json"
        if review_path.exists():
            review = load_json(review_path)
            for item in review.get("criteria", []):
                if isinstance(item, dict) and item.get("id") in design_system_wireframe.CRITERIA:
                    review_criteria.append(item["id"])
                    review_evidence.extend(item.get("evidence_ids", []))
                    if item.get("observation"):
                        review_rationales.append(item["id"] + ": " + item["observation"])
    sync_navigation_links(record, case_root)
    for row in record["coverage"]:
        if any(target["id"] == row["target_id"] and target["status"] == "accept_ai" for target in record["targets"]):
            row["status"] = "covered"
            row["evidence_ids"] = evidence_by_target.get(row["target_id"], {}).get(row["kind"], {}).get(row["source_id"], [])
            row["issue_ids"] = []
    content_hash, _ = design_system_wireframe.fingerprints(record)
    record["review"] = {
        "verdict": "suitable" if accepted else "needs_work",
        "rationale": "; ".join(review_rationales) if accepted and review_rationales else "One or more target engine gates require revision or fresh evidence.",
        "criteria": sorted(set(review_criteria)) if accepted else sorted(set(review_criteria))[:1],
        "evidence_ids": sorted(set(review_evidence)) if accepted else [],
        "issue_ids": [],
        "content_hash": content_hash,
        "knowledge_hash": record["knowledge_binding"]["content_hash"],
    }
    if accepted:
        content_hash, _ = design_system_wireframe.fingerprints(record)
        record["review"]["content_hash"] = content_hash
        record["status"] = "awaiting_confirmation"
    else:
        record["status"] = "in_progress"
    after_semantic_hash = semantic_record_hash(record)
    reused = before_semantic_hash == after_semantic_hash
    if not reused:
        record["history"].append({"change": "디자인 파이프라인 실행 결과 동기화", "reason": "freeze/gate와 현재 캡처, W1-W7 검토, 디자인 결정을 canonical record에 반영했다."})
        atomic_json(record_path, record)
    validation = design_system_wireframe.validate(record, record_path)
    result = {"case_path": str(Path(case_root).resolve()), "command": "sync", "reused": reused, "target_results": results, "validation": validation}
    duration_ms = (time.perf_counter() - started) * 1000
    for target in select_targets(record, target_id):
        atomic_json(assert_run_dir(case_root, record, target) / "sync-command.json", {
            "schema_version": 1,
            "command": "sync",
            "argv": ["wireframe.py", "sync", str(Path(case_root).resolve()), "--target-id", target["id"]],
            "cwd": str(ROOT),
            "started_at": started_at,
            "finished_at": now(),
            "duration_ms": round(duration_ms, 3),
            "exit_code": 0,
            "run_id": target["run_id"],
            "result_summary": summarize_engine_result("sync", result),
            "error": "",
        })
    record_common_engine_event(case_root, "sync", target_id, "", result, started_at, duration_ms)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("status", "spec", "runtime", "freeze", "gate", "sync"))
    parser.add_argument("case", type=Path)
    parser.add_argument("--target-id")
    args = parser.parse_args()
    try:
        if args.command == "sync":
            result, code = sync(args.case.resolve(), args.target_id), 0
        elif args.command == "status":
            record = load_json(command_record_path(args.case.resolve()))
            targets = []
            for target in select_targets(record, args.target_id):
                assert_run_dir(args.case.resolve(), record, target)
                targets.append({"target_id": target["id"], "run_id": target["run_id"], "status": target["status"]})
            result = {"case_path": str(args.case.resolve()), "targets": targets}
            code = 0
        else:
            result, code = engine_command(args.case.resolve(), args.command, args.target_id), 0
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        result, code = {"error": str(exc)}, 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
