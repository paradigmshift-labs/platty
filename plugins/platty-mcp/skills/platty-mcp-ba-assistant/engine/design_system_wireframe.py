#!/usr/bin/env python3
"""Validate and render design-system wireframe records. Does not run sessions or renderers."""
import argparse
import copy
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import re
import sys

import planning_context
import screen_behavior
import design_tokens
from paths import PLUGIN_ROOT, WORKSPACE_ROOT


ROOT = PLUGIN_ROOT
TEMPLATE = ROOT / "schemas/design-system-wireframe.template.json"
VALIDATOR_VERSION = "design-system-wireframe-1"
CRITERIA = tuple(f"W{i}" for i in range(1, 8))
CRITERION_DEFINITIONS = {
    'W1': '정보 위계 — 무엇을 먼저 읽게 되는지가 상위가 정한 중요도와 맞는가',
    'W2': 'composition — 역할의 구성 요소 중 채택한 것과 기각한 것에 근거가 있는가',
    'W3': 'density — 한 화면에 들어오는 양이 이 job의 실제 규모와 맞는가',
    'W4': 'spacing — 모든 간격이 팩의 단계에서 왔고 임의 값이 없는가',
    'W5': 'typography — 크기와 굵기의 종류가 제한되고 팩의 scale 안에 있는가',
    'W6': 'color — 강조색이 몇 곳에만 쓰이고 상태 구분이 색 하나에 기대지 않는가',
    'W7': '상태 구분 — 렌더 케이스가 서로 다른 픽셀을 내고 역할의 상태 계약을 지키는가',
}
TARGET_STATUSES = ("draft", "running", "accept_ai", "revise", "insufficient_evidence", "invalid")
GATE_VERDICTS = ("accept_ai", "revise", "insufficient_evidence", "invalid")
COVERAGE_KINDS = ("screen", "element", "state_axis", "transition", "render_case", "design_handoff")
COVERAGE_FIELD_BY_KIND = {
    "screen": "screen_ids",
    "element": "element_ids",
    "state_axis": "state_axis_ids",
    "transition": "transition_ids",
    "render_case": "render_case_ids",
    "design_handoff": "design_handoff_ids",
}
STATE_PROPERTIES = ("visible", "checked", "selected", "disabled", "readonly", "busy", "invalid", "expanded", "focus", "value")
REQUIRED_DECISION_STAGES = ("roles", "reference_transfer", "hierarchy", "layout", "components", "tokens")
# 3단계가 축의 `dimension`을 고르는 순간 4단계가 무엇을 단정해야 하는지가 정해지는데,
# 두 어휘가 **서로 달랐다**. 7차 실측: 3단계 11개 중 4개만 겹치고, 여기에만 있는 키 다섯은
# 어떤 산출물도 만들지 않는 죽은 키였다. 겹치지 않는 일곱은 요구가 **0**이 되어
# `visible` 하나만 적어도 통과했다 — 로딩 축이 `busy`를 요구받지 않았다.
#
# 이름은 3단계가 정한다(`coverage-model.md`의 열한 축). 은퇴한 이름은 별칭으로만 남긴다.
STATE_AXIS_PROPERTIES_BY_DIMENSION = {
    # 표시 / 숨김 / 조건부 표시
    "visibility": ("visible",),
    # 사용 가능 / 사용 불가 / 읽기 전용
    "availability": ("disabled", "readonly"),
    # 빈 값 / 값 있음, 미선택 / 선택 / 일부 선택
    "value_selection": ("checked", "selected", "value"),
    # 접힘 / 펼침, 닫힘 / 열림
    "disclosure": ("expanded",),
    # hover · 키보드 focus · 누르고 있는 동안
    "interaction": ("focus",),
    # 미검증 / 유효 / 오류 / 검증 중
    "validation": ("invalid",),
    # 대기 전 / 진행 중 / 성공 / 실패 — 진행 중은 busy로 말한다
    "operation": ("busy",),
    # 최초 로딩 / 내용 있음 / 비어 있음 / 부분 내용 / 오류
    "content": ("busy", "visible"),
    # 최신 / 재조회 중 기존값 / 오래됨 / 충돌
    "freshness": ("busy",),
    # 변경 전 / 수정 중 / 보존 / 초기화 / 복원
    "continuity": ("value",),
    # 이름·설명 / 상태 전달 / 오류 연결 / 포커스 진입·복귀
    "feedback_access": ("focus", "invalid"),
    # 은퇴한 이름들 — 예전 산출물이 읽히도록 남긴다.
    "selection": ("checked", "selected", "value"),
    "expansion": ("expanded",),
    "focus": ("focus",),
    "loading": ("busy",),
    "readability": ("readonly",),
}


def digest(value):
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result

    def reject_constant(value):
        raise ValueError(f"invalid JSON constant: {value}")

    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=pairs, parse_constant=reject_constant)


def required_state_properties(screen_source, axis_id):
    if not isinstance(screen_source, dict):
        return ()
    axis = next((row for row in screen_source.get("state_axes", []) if row.get("id") == axis_id), {})
    dimension = axis.get("dimension", "")
    if dimension == "availability" and {row.get("id") for row in axis.get("values", [])} == {"enabled"}:
        scope = axis.get("scope_id")
        element = next((row for row in screen_source.get("elements", []) if row.get("id") == scope), {})
        if element.get("semantic_type") in ("status", "information"):
            return ("visible",)
    return tuple(prop for prop in STATE_AXIS_PROPERTIES_BY_DIMENSION.get(dimension, ()) if prop in STATE_PROPERTIES)


def check_shape(value, shape, path, errors):
    if hasattr(shape, "shapes"):
        for choice in shape.shapes:
            candidate = []
            check_shape(value, choice, path, candidate)
            if not candidate:
                return
        errors.append(path + ": no matching closed union shape")
        return
    screen_behavior.check_shape(value, shape, path, errors)


def _shape_compatible_record(data):
    normalized = copy.deepcopy(data)
    for target in normalized.get("targets", []) if isinstance(normalized, dict) else []:
        for row in target.get("state_mappings", []) if isinstance(target, dict) else []:
            if isinstance(row, dict):
                if row.get("item_ref") is None:
                    row["item_ref"] = ""
    return normalized


SOURCE_BINDING = {
    "path": str,
    "content_hash": str,
    "review_hash": str,
    "confirmation_turn_id": str,
    "project_id": str,
    "observed_revision": str,
}
ASSESSMENT = {
    "verdict": ("pending", "suitable", "needs_work", "insufficient_evidence"),
    "rationale": str,
    "criteria": [str],
    "evidence_ids": [str],
    "issue_ids": [str],
    "content_hash": str,
    "knowledge_hash": str,
}
ISSUE = {
    "id": str,
    "question": str,
    "target": ("screen_behavior", "wireframe", "design_system", "development", "external"),
    "blocking": bool,
    "reason": str,
    "target_refs": [str],
    "action": {"kind": ("ask_user", "refresh_input", "refresh_knowledge", "retry_stage", "wait", "handoff"), "prompt": str},
    **planning_context.TICKET_FIELDS,
}
DECISION_RESULT = {
    "status": ("pending", "verified", "needs_work", "not_applicable"),
    "rationale": str,
    "evidence_ids": [str],
}
STATE_ASSERTION = {"property": STATE_PROPERTIES, "expected": screen_behavior.OneOf(bool, str), "selector": str, "runtime_check_id": str}
TRANSITION_ASSERTION = {
    "transition_id": str,
    "trigger": str,
    "guard": str,
    "observable_result": str,
    "preserved_values": [str],
    "focus_result": str,
    "runtime_check_id": str,
}
GATE_ARTIFACT = {"path": str, "hash": str}
TARGET = {
    "id": str,
    "screen_id": str,
    "status": TARGET_STATUSES,
    "input_refs": [str],
    "required_coverage": {
        "screen_ids": [str],
        "element_ids": [str],
        "state_axis_ids": [str],
        "transition_ids": [str],
        "render_case_ids": [str],
        "design_handoff_ids": [str],
    },
    "run_id": str,
    "parent_run_id": str,
    "retry_stages": [str],
    "brief_path": str,
    "packet_path": str,
    "spec_path": str,
    "renderer_path": str,
    "artifact_hashes": {"brief": str, "packet": str, "spec": str, "renderer": str},
    "detail_mode": ("inline", "artifact"),
    "detail_artifact": {"path": str, "hash": str},
    "design_decisions": {stage: DECISION_RESULT for stage in REQUIRED_DECISION_STAGES},
    "state_mappings": [{
        "render_case_id": str,
        "item_ref": str,
        "state_axis_id": str,
        "transition_id": str,
        "design_state_id": str,
        "state_assertions": [STATE_ASSERTION],
        "capture_id": str,
    }],
    "transition_assertions": [TRANSITION_ASSERTION],
    "component_mappings": [{
        "element_id": str,
        "hds_component": str,
        "interface": str,
        "props": dict,
        "version": str,
        "knowledge_ref": str,
    }],
    "token_mappings": [{
        "semantic_token": str,
        "value": str,
        "knowledge_ref": str,
        "applied_to": [str],
    }],
    "runtime_checks": [{
        "id": str,
        "status": ("pass", "fail", "not_run", "blocked"),
        "evidence_path": str,
        "source_hash": str,
    }],
    "captures": [{
        "id": str,
        "render_case_id": str,
        "viewport": str,
        "state": str,
        "path": str,
        "image_hash": str,
        "source_hash": str,
    }],
    "gate": {
        "verdict": GATE_VERDICTS,
        "rationale": str,
        "review_id": str,
        "input_hash": str,
        "knowledge_hash": str,
        "artifact_hashes": {"spec": str, "renderer": str, "runtime": [str]},
        "artifacts": {
            "decisions": GATE_ARTIFACT,
            "capture": GATE_ARTIFACT,
            "review": GATE_ARTIFACT,
            "result": GATE_ARTIFACT,
        },
        "capture_hashes": [str],
        "blocking_issue_ids": [str],
        "retry_stage": str,
    },
}
SHAPE = {
    "schema_version": (1,),
    "model_profile": ("design_system_wireframe_v1",),
    "case_id": str,
    "title": str,
    "status": ("in_progress", "awaiting_confirmation", "waiting", "needs_attention", "complete"),
    "input_binding": {"screen_behavior": SOURCE_BINDING},
    "knowledge_binding": {"pack_id": str, "version": str, "content_hash": str, "source_revisions": [str]},
    "targets": [TARGET],
    "navigation_links": [{
        "id": str,
        "from_target_id": str,
        "to_target_id": str,
        "trigger_ref": str,
        "status": ("pending", "verified", "broken"),
    }],
    "coverage": [{
        "target_id": str,
        "kind": COVERAGE_KINDS,
        "source_id": str,
        "status": ("covered", "gap", "not_applicable"),
        "evidence_ids": [str],
        "issue_ids": [str],
    }],
    "issues": [ISSUE],
    **planning_context.MAP_FIELDS,
    "review": ASSESSMENT,
    "confirmation": {
        "confirmed": bool,
        "turn_id": str,
        "statement": str,
        "content_hash": str,
        "review_hash": str,
        "input_hash": str,
        "knowledge_hash": str,
    },
    "history": [{"change": str, "reason": str}],
}


def fingerprints(data):
    content_fields = (
        "schema_version",
        "model_profile",
        "case_id",
        "title",
        "input_binding",
        "knowledge_binding",
        "targets",
        "navigation_links",
        "coverage",
        "issues",
    )
    payload = {key: data[key] for key in content_fields}
    # Only a used scope ruling joins the hash, so artifacts written before it keep their approval.
    if data.get("out_of_scope"):
        payload["out_of_scope"] = data["out_of_scope"]
    content = digest(payload)
    review = digest({"content_hash": content, "knowledge_hash": data["knowledge_binding"]["content_hash"], "review": data["review"]})
    return content, review


def invalid_report(errors):
    return {
        "valid": False,
        "baseline_ready": False,
        "input_ready": False,
        "knowledge_ready": False,
        "ready_for_confirmation": False,
        "complete": False,
        "errors": errors,
        "completion_errors": [],
        "content_hash": "",
        "review_hash": "",
        "input_hash": "",
        "knowledge_hash": "",
        "coverage": [],
        "target_gate_verdicts": {},
        "upstream_inventory": {},
        "next_actions": [],
        "validator_version": VALIDATOR_VERSION,
    }


def _coverage_expected(target):
    return {f"{target['id']}:{kind}:{source_id}" for kind, field in COVERAGE_FIELD_BY_KIND.items() for source_id in target["required_coverage"][field]}


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def knowledge_pack_fingerprint(pack_path):
    pack_path = Path(pack_path)
    manifest_path = pack_path.with_name("upstream-manifest.json")
    return hashlib.sha256(pack_path.read_bytes() + manifest_path.read_bytes()).hexdigest()


def _canonical_pack_index(pack, token_errors=None):
    if not isinstance(pack, dict):
        return {}, {}, {}, {}, set(), {}
    components = {
        row.get("ref"): row
        for row in pack.get("componentKnowledge", [])
        if isinstance(row, dict) and row.get("ref")
    }
    interfaces = {
        (row.get("file"), row.get("interface")): row
        for row in pack.get("componentProps", {}).get("interfaces", [])
        if isinstance(row, dict) and row.get("file") and row.get("interface")
    }
    state_map = {
        row.get("component"): set(row.get("states", []))
        for row in pack.get("componentStateMap", [])
        if isinstance(row, dict) and row.get("component")
    }
    for row in components.values():
        if row.get("component") and row.get("supportedStates"):
            state_map.setdefault(row["component"], set(row["supportedStates"]))
    tokens, errors = design_tokens.resolve_token_map(pack)
    if token_errors is not None:
        token_errors.extend(errors)
    knowledge_refs = set(components) | {"token:" + token for token in tokens}
    knowledge_ref_kinds = {ref: "component" for ref in components}
    knowledge_ref_kinds.update({"token:" + token: "token" for token in tokens})
    for row in pack.get("references", []):
        if isinstance(row, dict) and row.get("id"):
            knowledge_refs.add(row["id"])
            if row.get("kind"):
                knowledge_ref_kinds[row["id"]] = row["kind"]
    return components, interfaces, state_map, tokens, knowledge_refs, knowledge_ref_kinds


def _parse_interface_ref(value):
    if "#" not in value:
        return "", ""
    file_name, interface_name = value.split("#", 1)
    return file_name, interface_name


def _same_guard_meaning(guard, preconditions):
    normalized_guard = " ".join(str(guard).split())
    for precondition in preconditions:
        normalized_precondition = " ".join(str(precondition).split())
        if normalized_guard == normalized_precondition:
            return True
        if normalized_precondition and normalized_precondition in normalized_guard:
            return True
        if normalized_guard and normalized_guard in normalized_precondition:
            return True
    return False


def _resolve_case_path(case_root, value):
    path = Path(value)
    if path.is_absolute():
        raise ValueError("artifact path must be relative and stay under case root")
    root = Path(case_root).resolve()
    resolved = (root / path).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError("artifact path must be relative and stay under case root") from exc
    return resolved


def _load_target_details(case_root, target, path, gaps):
    details = {
        "state_mappings": target["state_mappings"],
        "component_mappings": target["component_mappings"],
        "token_mappings": target["token_mappings"],
    }
    if target.get("detail_mode") != "artifact":
        return details
    artifact = target.get("detail_artifact", {})
    try:
        detail_path = _resolve_case_path(case_root, artifact.get("path", ""))
        actual = file_hash(detail_path)
        require_hash = artifact.get("hash", "")
        if actual != require_hash:
            gaps.append(path + ".detail_artifact.hash: stale detail artifact hash")
        loaded = load_json(detail_path)
    except ValueError as exc:
        gaps.append(path + ".detail_artifact.path: " + str(exc))
        return details
    except OSError as exc:
        gaps.append(path + ".detail_artifact.path: missing detail artifact file: " + str(exc))
        return details
    except (UnicodeError, json.JSONDecodeError) as exc:
        gaps.append(path + ".detail_artifact.path: cannot parse detail artifact: " + str(exc))
        return details
    if loaded.get("target_id") != target["id"] or loaded.get("screen_id") != target["screen_id"] or loaded.get("run_id") != target["run_id"]:
        gaps.append(path + ".detail_artifact: target identity mismatch")
    for key in details:
        if not isinstance(loaded.get(key), list):
            gaps.append(path + ".detail_artifact." + key + ": array required")
        else:
            details[key] = loaded[key]
    return details


def _screen_inventory(source, screen_id):
    elements = {row["id"] for row in source["elements"] if row["screen_id"] == screen_id}
    scopes = elements | {screen_id}
    return {
        "screen": {screen_id} if any(row["id"] == screen_id for row in source["screens"]) else set(),
        "element": elements,
        "state_axis": {row["id"] for row in source["state_axes"] if row["scope_id"] in scopes},
        "transition": {row["id"] for row in source["transitions"] if set(row["target_scope_ids"]) & scopes},
        "render_case": {row["id"] for row in source["render_cases"] if row["screen_id"] == screen_id},
        "design_handoff": {row["id"] for row in source["design_handoffs"] if row["screen_id"] == screen_id},
    }


def _inventory_ids(inventory):
    result = set()
    for values in inventory.values():
        result.update(values)
    return result


def _load_bound_screen_behavior(binding, gaps):
    try:
        source = load_json(binding["path"])
    except (OSError, UnicodeError, ValueError) as exc:
        gaps.append("$.input_binding.screen_behavior.path: cannot load bound screen behavior: " + str(exc))
        return None
    if source.get("schema_version") != 3:
        gaps.append("$.input_binding.screen_behavior: bound screen behavior must be current schema3")
        return source
    report = screen_behavior.validate(source)
    if not report.get("complete"):
        gaps.append("$.input_binding.screen_behavior: bound screen behavior is not complete")
    content_hash, review_hash = screen_behavior.fingerprints(source)
    current = {
        "path": str(Path(binding["path"])),
        "content_hash": content_hash,
        "review_hash": review_hash,
        "confirmation_turn_id": source.get("confirmation", {}).get("turn_id", ""),
        "project_id": source.get("evidence_status", {}).get("project_id", ""),
        "observed_revision": source.get("evidence_status", {}).get("observed_revision", ""),
    }
    expected = {key: binding[key] for key in current}
    if expected != current:
        gaps.append("$.input_binding.screen_behavior: stale screen behavior binding")
    return source


def _load_knowledge_pack(binding, gaps):
    pack_path = WORKSPACE_ROOT / "design-knowledge" / binding["pack_id"] / binding["version"] / "pack.json"
    try:
        pack = load_json(pack_path)
        current_hash = knowledge_pack_fingerprint(pack_path)
    except (OSError, UnicodeError, ValueError) as exc:
        gaps.append("$.knowledge_binding: cannot load knowledge pack: " + str(exc))
        return None
    if current_hash != binding["content_hash"]:
        gaps.append("$.knowledge_binding.content_hash: knowledge pack hash mismatch")
    if binding["source_revisions"] and pack.get("version") not in binding["source_revisions"]:
        gaps.append("$.knowledge_binding.source_revisions: bound revisions do not include pack version")
    return pack


def _check_gate_review(review, target, input_hash, knowledge_hash, capture_hashes, path, gaps):
    if not isinstance(review, dict):
        gaps.append(path + ".gate.artifacts.review: gate review artifact must be an object")
        return
    if review.get("verdict") not in ("accept_ai", "pass"):
        gaps.append(path + ".gate.artifacts.review.verdict: gate review verdict is not accept_ai/pass")
    if review.get("input_hash") != input_hash:
        gaps.append(path + ".gate.artifacts.review.input_hash: stale gate review input hash")
    if review.get("knowledge_hash") != knowledge_hash:
        gaps.append(path + ".gate.artifacts.review.knowledge_hash: stale gate review knowledge hash")
    if review.get("spec_hash") != target["artifact_hashes"]["spec"]:
        gaps.append(path + ".gate.artifacts.review.spec_hash: stale gate review spec hash")
    if review.get("renderer_hash") != target["artifact_hashes"]["renderer"]:
        gaps.append(path + ".gate.artifacts.review.renderer_hash: stale gate review renderer hash")
    if Counter(review.get("capture_hashes", [])) != Counter(capture_hashes):
        gaps.append(path + ".gate.artifacts.review.capture_hashes: gate review capture hashes are stale")

    expected_by_id = {row["id"]: row for row in target["captures"]}
    expected_by_path = {row["path"]: row for row in target["captures"]}
    expected_captures = {(row["id"], row["path"], row["image_hash"]) for row in target["captures"]}
    viewed_captures = review.get("viewed_captures", [])
    if not isinstance(viewed_captures, list):
        gaps.append(path + ".gate.artifacts.review.viewed_captures: viewed captures must be an array")
        viewed_captures = []
    observed_captures = set()
    hash_mismatch = False
    for index, capture in enumerate(viewed_captures):
        if not isinstance(capture, dict):
            gaps.append(path + f".gate.artifacts.review.viewed_captures[{index}]: viewed capture must be an object")
            continue
        review_hash = capture.get("image_hash", capture.get("hash"))
        primary = expected_by_id.get(capture.get("id")) or expected_by_path.get(capture.get("path"))
        if primary is None:
            gaps.append(path + f".gate.artifacts.review.viewed_captures[{index}]: unknown capture")
        else:
            if review_hash != primary["image_hash"]:
                hash_mismatch = True
            observed_captures.add((primary["id"], primary["path"], primary["image_hash"]))
        observations = capture.get("observations", [])
        if not isinstance(observations, list) or not any(isinstance(item, str) and item.strip() for item in observations):
            gaps.append(path + f".gate.artifacts.review.viewed_captures[{index}]: observations required")
        for ref in capture.get("covers", []):
            covered = expected_by_id.get(ref) or expected_by_path.get(ref)
            if covered is None:
                gaps.append(path + f".gate.artifacts.review.viewed_captures[{index}]: unknown covered capture {ref}")
                continue
            if review_hash != covered["image_hash"]:
                hash_mismatch = True
            observed_captures.add((covered["id"], covered["path"], covered["image_hash"]))
    if {(cid, cpath) for cid, cpath, _ in observed_captures} != {(cid, cpath) for cid, cpath, _ in expected_captures}:
        gaps.append(path + ".gate.artifacts.review.viewed_captures: gate review did not view current captures")
    if observed_captures != expected_captures or hash_mismatch:
        gaps.append(path + ".gate.artifacts.review.viewed_captures: gate review capture hash mismatch")

    criteria = review.get("criteria", [])
    if not isinstance(criteria, list):
        gaps.append(path + ".gate.artifacts.review.criteria: criteria must be an array")
        criteria = []
    criteria_by_id = {item.get("id"): item for item in criteria if isinstance(item, dict)}
    missing = sorted(set(CRITERIA) - set(criteria_by_id))
    if missing:
        gaps.append(path + ".gate.artifacts.review.criteria: missing review criteria " + ", ".join(missing))
    observations = []
    for criterion in CRITERIA:
        item = criteria_by_id.get(criterion)
        if not item:
            continue
        observation = str(item.get("observation", "")).strip()
        if not observation:
            gaps.append(path + ".gate.artifacts.review.criteria." + criterion + ": nonempty observation required")
        else:
            observations.append(observation)
        evidence = item.get("evidence_ids", [])
        if not isinstance(evidence, list) or not evidence or any(not isinstance(value, str) or not value.strip() for value in evidence):
            gaps.append(path + ".gate.artifacts.review.criteria." + criterion + ": nonempty evidence required")
    if len(observations) == len(CRITERIA) and len(set(observations)) == 1:
        gaps.append(path + ".gate.artifacts.review.criteria: criteria observations must be axis-specific")
    findings = review.get("findings", [])
    if not isinstance(findings, list):
        gaps.append(path + ".gate.artifacts.review.findings: findings must be an array")
    elif any(isinstance(item, dict) and item.get("blocking") for item in findings):
        gaps.append(path + ".gate.artifacts.review.findings: gate review has blocking findings")


def validate(data, path=None):
    errors, gaps, coverage_metrics = [], [], []
    check_shape(_shape_compatible_record(data), SHAPE, "$", errors)
    report = invalid_report(errors)
    if errors:
        return report
    content_hash, review_hash = fingerprints(data)
    input_hash = data["input_binding"]["screen_behavior"]["content_hash"]
    knowledge_hash = data["knowledge_binding"]["content_hash"]
    report.update(content_hash=content_hash, review_hash=review_hash, input_hash=input_hash, knowledge_hash=knowledge_hash)

    def require(condition, path, message, dest=errors):
        if not condition:
            dest.append(f"{path}: {message}")

    def text(value, path, dest=errors):
        require(bool(value.strip()), path, "nonempty text required", dest)

    def hex_hash(value, path, dest=errors):
        require(bool(re.fullmatch(r"[a-f0-9]{64}", value)), path, "SHA-256 hash required", dest)

    def refs(values, known, path, dest=errors):
        require(len(values) == len(set(values)), path, "duplicate references", dest)
        for value in values:
            require(value in known, path, f"unknown reference {value!r}", dest)

    text(data["title"], "$.title")
    require(bool(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", data["case_id"])), "$.case_id", "lowercase letters, numbers, and hyphens required")

    binding = data["input_binding"]["screen_behavior"]
    input_start = len(gaps)
    for key in ("path", "content_hash", "review_hash", "confirmation_turn_id", "project_id", "observed_revision"):
        text(binding[key], "$.input_binding.screen_behavior." + key, gaps)
    for key in ("content_hash", "review_hash"):
        hex_hash(binding[key], "$.input_binding.screen_behavior." + key, gaps)
    screen_source = _load_bound_screen_behavior(binding, gaps) if binding["path"] else None
    report["input_ready"] = len(gaps) == input_start

    knowledge = data["knowledge_binding"]
    knowledge_start = len(gaps)
    for key in ("pack_id", "version", "content_hash"):
        text(knowledge[key], "$.knowledge_binding." + key, gaps)
    hex_hash(knowledge_hash, "$.knowledge_binding.content_hash", gaps)
    require(bool(knowledge["source_revisions"]), "$.knowledge_binding.source_revisions", "versioned source revisions required", gaps)
    pack = _load_knowledge_pack(knowledge, gaps) if knowledge["pack_id"] and knowledge["version"] else None
    case_root = Path(path).resolve().parent if path is not None else Path.cwd()
    token_errors = []
    component_refs, interface_index, state_map, semantic_token_map, knowledge_refs, knowledge_ref_kinds = _canonical_pack_index(pack, token_errors)
    for error in token_errors:
        gaps.append("$.knowledge_binding.tokens: " + error)
    report["knowledge_ready"] = len(gaps) == knowledge_start
    report["baseline_ready"] = report["input_ready"] and report["knowledge_ready"]
    semantic_tokens = set(semantic_token_map)

    target_ids, issue_ids = set(), set()
    evidence_ids = set()
    screen_to_target = {}
    upstream_by_target = {}
    upstream_screen_ids = {row["id"] for row in screen_source.get("screens", [])} if isinstance(screen_source, dict) else set()
    errors.extend(planning_context.map_gaps(data, {row["id"] for row in data.get("sources", [])}))
    for n, issue in enumerate(data["issues"]):
        path = f"$.issues[{n}]"
        text(issue["id"], path + ".id")
        require(issue["id"] not in issue_ids, path + ".id", "duplicate id")
        issue_ids.add(issue["id"])
        for key in ("question", "reason"):
            text(issue[key], path + "." + key)
        text(issue["action"]["prompt"], path + ".action.prompt")
        if issue["blocking"] and not planning_context.closed(issue):
            gaps.append(path + ": unresolved blocking issue")
    for n, target in enumerate(data["targets"]):
        path = f"$.targets[{n}]"
        text(target["id"], path + ".id")
        require(target["id"] not in target_ids, path + ".id", "duplicate target id")
        target_ids.add(target["id"])
        require(target["screen_id"] not in screen_to_target, path + ".screen_id", "duplicate target for screen")
        screen_to_target[target["screen_id"]] = target["id"]
        for key in ("screen_id", "run_id", "brief_path", "packet_path", "spec_path", "renderer_path"):
            text(target[key], path + "." + key, gaps)
        require(target["parent_run_id"] != target["run_id"], path + ".parent_run_id", "cannot equal run_id", gaps)
        artifact_fields = {"brief": "brief_path", "packet": "packet_path", "spec": "spec_path", "renderer": "renderer_path"}
        for key, field in artifact_fields.items():
            try:
                artifact_path = _resolve_case_path(case_root, target[field])
                actual = file_hash(artifact_path)
                require(actual == target["artifact_hashes"][key], path + ".artifact_hashes." + key, "stale " + key + " file hash", gaps)
            except ValueError as exc:
                gaps.append(path + "." + field + ": " + str(exc))
            except OSError as exc:
                gaps.append(path + "." + field + ": missing artifact file: " + str(exc))
        if screen_source:
            actual_inventory = _screen_inventory(screen_source, target["screen_id"])
            upstream_by_target[target["id"]] = actual_inventory
            require(target["screen_id"] in upstream_screen_ids, path + ".screen_id", "unknown upstream screen", gaps)
            expected_refs = _inventory_ids(actual_inventory)
            require(set(target["input_refs"]) == expected_refs, path + ".input_refs", "input_refs must exactly match upstream screen inventory", gaps)
            for kind, field in COVERAGE_FIELD_BY_KIND.items():
                declared = set(target["required_coverage"][field])
                actual = actual_inventory[kind]
                require(declared == actual, path + ".required_coverage." + field, "underdeclared upstream inventory for " + kind, gaps)
        require(target["status"] == target["gate"]["verdict"], path + ".gate.verdict", "target status must match gate verdict", gaps)
        require(target["gate"]["input_hash"] == input_hash, path + ".gate.input_hash", "stale target gate input hash", gaps)
        require(target["gate"]["knowledge_hash"] == knowledge_hash, path + ".gate.knowledge_hash", "stale target gate knowledge hash", gaps)
        refs(target["gate"]["blocking_issue_ids"], issue_ids, path + ".gate.blocking_issue_ids", gaps)
        if target["gate"]["verdict"] == "accept_ai":
            text(target["gate"]["rationale"], path + ".gate.rationale", gaps)
            require(not target["gate"]["blocking_issue_ids"], path + ".gate.blocking_issue_ids", "accept_ai cannot retain blocking issues", gaps)
            require(not target["retry_stages"] and target["gate"]["retry_stage"] == "", path + ".retry_stages", "accepted target cannot retain retry stage", gaps)
        else:
            require(bool(target["retry_stages"] or target["gate"]["retry_stage"]), path + ".retry_stages", "non-accepted target requires retry stage", gaps)
        for row in target["runtime_checks"]:
            evidence_ids.add(row["id"])
            if row["status"] != "pass":
                gaps.append(path + ".runtime_checks." + row["id"] + ": runtime check did not pass")
            hex_hash(row["source_hash"], path + ".runtime_checks." + row["id"] + ".source_hash", gaps)
            try:
                actual = file_hash(_resolve_case_path(case_root, row["evidence_path"]))
                require(actual == row["source_hash"], path + ".runtime_checks." + row["id"] + ".source_hash", "stale runtime file hash", gaps)
            except ValueError as exc:
                gaps.append(path + ".runtime_checks." + row["id"] + ".evidence_path: " + str(exc))
            except OSError as exc:
                gaps.append(path + ".runtime_checks." + row["id"] + ".evidence_path: missing runtime evidence: " + str(exc))
        capture_hashes = []
        for row in target["captures"]:
            evidence_ids.add(row["id"])
            capture_hashes.append(row["image_hash"])
            hex_hash(row["image_hash"], path + ".captures." + row["id"] + ".image_hash", gaps)
            hex_hash(row["source_hash"], path + ".captures." + row["id"] + ".source_hash", gaps)
            try:
                actual = file_hash(_resolve_case_path(case_root, row["path"]))
                require(actual == row["image_hash"], path + ".captures." + row["id"] + ".image_hash", "stale capture file hash", gaps)
            except ValueError as exc:
                gaps.append(path + ".captures." + row["id"] + ".path: " + str(exc))
            except OSError as exc:
                gaps.append(path + ".captures." + row["id"] + ".path: missing capture file: " + str(exc))
            renderer_hash = target["artifact_hashes"].get("renderer")
            require(row["source_hash"] == renderer_hash, path + ".captures." + row["id"] + ".source_hash", "capture source hash must match current renderer", gaps)
        require(Counter(target["gate"]["capture_hashes"]) == Counter(capture_hashes), path + ".gate.capture_hashes", "gate must cover current captures exactly", gaps)
        require(target["gate"]["artifact_hashes"]["spec"] == target["artifact_hashes"]["spec"], path + ".gate.artifact_hashes.spec", "stale spec gate hash", gaps)
        require(target["gate"]["artifact_hashes"]["renderer"] == target["artifact_hashes"]["renderer"], path + ".gate.artifact_hashes.renderer", "stale renderer gate hash", gaps)
        require(Counter(target["gate"]["artifact_hashes"]["runtime"]) == Counter(row["source_hash"] for row in target["runtime_checks"]), path + ".gate.artifact_hashes.runtime", "gate must cover runtime evidence exactly", gaps)
        for name, artifact in target["gate"]["artifacts"].items():
            text(artifact["path"], path + ".gate.artifacts." + name + ".path", gaps)
            hex_hash(artifact["hash"], path + ".gate.artifacts." + name + ".hash", gaps)
            try:
                artifact_path = _resolve_case_path(case_root, artifact["path"])
                actual = file_hash(artifact_path)
                require(actual == artifact["hash"], path + ".gate.artifacts." + name + ".hash", "stale gate " + name + " artifact hash", gaps)
                if name == "review":
                    try:
                        review_artifact = load_json(artifact_path)
                        _check_gate_review(review_artifact, target, input_hash, knowledge_hash, capture_hashes, path, gaps)
                    except (OSError, UnicodeError, ValueError) as exc:
                        gaps.append(path + ".gate.artifacts.review.path: cannot parse gate review artifact: " + str(exc))
            except ValueError as exc:
                gaps.append(path + ".gate.artifacts." + name + ".path: " + str(exc))
            except OSError as exc:
                gaps.append(path + ".gate.artifacts." + name + ".path: missing gate artifact file: " + str(exc))
        for stage, decision in target["design_decisions"].items():
            if decision["status"] != "verified":
                gaps.append(path + ".design_decisions." + stage + ": design decision not verified")
            text(decision["rationale"], path + ".design_decisions." + stage + ".rationale", gaps)
            refs(decision["evidence_ids"], evidence_ids | {"review-" + target["id"], target["gate"]["review_id"]}, path + ".design_decisions." + stage + ".evidence_ids", gaps)
        captures = {row["id"] for row in target["captures"]}
        render_cases = set(target["required_coverage"]["render_case_ids"])
        state_axes = set(target["required_coverage"]["state_axis_ids"])
        transitions = set(target["required_coverage"]["transition_ids"])
        elements = set(target["required_coverage"]["element_ids"])
        detail = _load_target_details(case_root, target, path, gaps)
        state_mappings = detail["state_mappings"]
        component_mappings = detail["component_mappings"]
        token_mappings = detail["token_mappings"]
        for row in state_mappings:
            refs([row["render_case_id"]], render_cases, path + ".state_mappings.render_case_id", gaps)
            refs([row["state_axis_id"]], state_axes, path + ".state_mappings.state_axis_id", gaps)
            refs([row["transition_id"]], transitions, path + ".state_mappings.transition_id", gaps)
            refs([row["capture_id"]], captures, path + ".state_mappings.capture_id", gaps)
            text(row["design_state_id"], path + ".state_mappings.design_state_id", gaps)
            observed_properties = {assertion["property"] for assertion in row["state_assertions"]}
            if not observed_properties:
                gaps.append(path + ".state_mappings." + row["design_state_id"] + ": state assertions required")
            required_properties = required_state_properties(screen_source, row["state_axis_id"])
            if required_properties and not (set(required_properties) & observed_properties):
                gaps.append(path + ".state_mappings." + row["design_state_id"] + ": missing state assertions for " + row["state_axis_id"] + " (" + ", ".join(required_properties) + ")")
            for assertion in row["state_assertions"]:
                text(assertion["selector"], path + ".state_mappings.state_assertions.selector", gaps)
                refs([assertion["runtime_check_id"]], {check["id"] for check in target["runtime_checks"] if check["status"] == "pass"}, path + ".state_mappings.state_assertions.runtime_check_id", gaps)
        transition_assertions = {row["transition_id"]: row for row in target["transition_assertions"]}
        require(set(transition_assertions) == transitions, path + ".transition_assertions", "transition assertions must exactly match covered transitions", gaps)
        upstream_transitions = {row["id"]: row for row in screen_source.get("transitions", [])} if isinstance(screen_source, dict) else {}
        for transition_id, assertion in transition_assertions.items():
            upstream = upstream_transitions.get(transition_id, {})
            text(assertion["trigger"], path + ".transition_assertions.trigger", gaps)
            text(assertion["guard"], path + ".transition_assertions.guard", gaps)
            text(assertion["observable_result"], path + ".transition_assertions.observable_result", gaps)
            text(assertion["focus_result"], path + ".transition_assertions.focus_result", gaps)
            refs([assertion["runtime_check_id"]], {check["id"] for check in target["runtime_checks"] if check["status"] == "pass"}, path + ".transition_assertions.runtime_check_id", gaps)
            if upstream:
                require(assertion["trigger"] == upstream["event"], path + ".transition_assertions.trigger", "trigger differs from upstream transition", gaps)
                require(_same_guard_meaning(assertion["guard"], upstream["preconditions"]), path + ".transition_assertions.guard", "guard differs from upstream transition", gaps)
                require(assertion["observable_result"] == upstream["observable_result"], path + ".transition_assertions.observable_result", "observable result differs from upstream transition", gaps)
                require(assertion["focus_result"] == upstream["focus_result"], path + ".transition_assertions.focus_result", "focus result differs from upstream transition", gaps)
                if upstream["preserved_values"]:
                    require(bool(assertion["preserved_values"]), path + ".transition_assertions.preserved_values", "transition assertion missing preservation", gaps)
        for row in component_mappings:
            refs([row["element_id"]], elements, path + ".component_mappings.element_id", gaps)
            for key in ("hds_component", "interface", "version", "knowledge_ref"):
                text(row[key], path + ".component_mappings." + key, gaps)
            require(row["version"] == knowledge["version"], path + ".component_mappings.version", "component mapping must use current knowledge version", gaps)
            require(row["knowledge_ref"] in knowledge_refs, path + ".component_mappings.knowledge_ref", "unknown knowledge_ref " + row["knowledge_ref"], gaps)
            if row["knowledge_ref"] in knowledge_ref_kinds:
                require(knowledge_ref_kinds[row["knowledge_ref"]] == "component", path + ".component_mappings.knowledge_ref", "component knowledge_ref has wrong type", gaps)
            component = component_refs.get(row["knowledge_ref"], {})
            require(bool(component), path + ".component_mappings.knowledge_ref", "unknown component knowledge_ref " + row["knowledge_ref"], gaps)
            if component:
                require(component.get("component") == row["hds_component"], path + ".component_mappings.hds_component", "unknown component " + row["hds_component"], gaps)
                require(row["hds_component"] in state_map, path + ".component_mappings.hds_component", "unknown component state map " + row["hds_component"], gaps)
            file_name, interface_name = _parse_interface_ref(row["interface"])
            interface = interface_index.get((file_name, interface_name), {})
            if component and isinstance(component.get("interface"), dict):
                require(bool(interface), path + ".component_mappings.interface", "unknown interface " + row["interface"], gaps)
                expected_interface = (component["interface"].get("file"), component["interface"].get("interface"))
                require((file_name, interface_name) == expected_interface, path + ".component_mappings.interface", "interface differs from component knowledge", gaps)
            allowed_props = {prop.get("name") for prop in interface.get("props", []) if isinstance(prop, dict) and prop.get("name")}
            for prop in row["props"]:
                require(prop in allowed_props, path + ".component_mappings.props", "unknown component prop " + prop, gaps)
        for row in token_mappings:
            for key in ("semantic_token", "value", "knowledge_ref"):
                text(row[key], path + ".token_mappings." + key, gaps)
            refs(row["applied_to"], {target["screen_id"]} | elements, path + ".token_mappings.applied_to", gaps)
            require(row["semantic_token"] in semantic_tokens, path + ".token_mappings.semantic_token", "unknown semantic token " + row["semantic_token"], gaps)
            token_value = semantic_token_map.get(row["semantic_token"], "")
            if token_value:
                require(row["value"] == token_value, path + ".token_mappings.value", "token value differs from knowledge pack", gaps)
            require(row["knowledge_ref"] in knowledge_refs, path + ".token_mappings.knowledge_ref", "unknown knowledge_ref " + row["knowledge_ref"], gaps)
            if row["knowledge_ref"] in knowledge_ref_kinds:
                require(knowledge_ref_kinds[row["knowledge_ref"]] == "token", path + ".token_mappings.knowledge_ref", "token knowledge_ref has wrong type", gaps)
            if row["knowledge_ref"] in knowledge_refs and knowledge_ref_kinds.get(row["knowledge_ref"]) == "token":
                require(row["knowledge_ref"] == "token:" + row["semantic_token"], path + ".token_mappings.knowledge_ref", "token knowledge_ref does not match semantic token", gaps)
        require(set(render_cases) <= {row["render_case_id"] for row in target["captures"]}, path + ".captures", "every render case needs a current capture", gaps)
        require(set(render_cases) <= {row["render_case_id"] for row in state_mappings}, path + ".state_mappings", "every render case needs state mapping", gaps)
        require(state_axes <= {row["state_axis_id"] for row in state_mappings}, path + ".state_mappings", "every state axis needs design state mapping", gaps)
        require(elements <= {row["element_id"] for row in component_mappings}, path + ".component_mappings", "every element needs component mapping", gaps)
        require(bool(token_mappings), path + ".token_mappings", "semantic token mappings required", gaps)
        evidence_ids.add(target["gate"]["review_id"])
    require(bool(data["targets"]), "$.targets", "at least one target required", gaps)
    if screen_source:
        missing_screens = sorted(upstream_screen_ids - set(screen_to_target))
        if missing_screens:
            gaps.append("$.targets: missing target for upstream screens " + ", ".join(missing_screens))

    for n, link in enumerate(data["navigation_links"]):
        path = f"$.navigation_links[{n}]"
        refs([link["from_target_id"]], target_ids, path + ".from_target_id", gaps)
        refs([link["to_target_id"]], target_ids, path + ".to_target_id", gaps)
        if link["status"] != "verified":
            gaps.append(path + ": navigation link not verified")

    expected = set()
    for target in data["targets"]:
        expected |= _coverage_expected(target)
    observed = [f"{row['target_id']}:{row['kind']}:{row['source_id']}" for row in data["coverage"]]
    counts = Counter(observed)
    missing = sorted(expected - set(counts))
    duplicate = sorted(key for key, value in counts.items() if value > 1)
    unknown = sorted(set(counts) - expected)
    coverage_metric = {
        "id": "target_source_coverage",
        "numerator": len(expected & set(counts)) - len([row for row in data["coverage"] if row["status"] != "covered"]),
        "denominator": len(expected),
        "missing_ids": missing,
        "duplicate_ids": duplicate,
        "unknown_ids": unknown,
        "status": "covered" if expected and not missing and not duplicate and not unknown and all(row["status"] == "covered" for row in data["coverage"]) else "incomplete",
    }
    coverage_metrics.append(coverage_metric)
    if missing:
        gaps.append("coverage: missing exact source targets " + ", ".join(missing))
    if unknown:
        errors.append("coverage: unknown source targets " + ", ".join(unknown))
    if duplicate:
        errors.append("coverage: duplicate source targets " + ", ".join(duplicate))
    for n, row in enumerate(data["coverage"]):
        path = f"$.coverage[{n}]"
        refs([row["target_id"]], target_ids, path + ".target_id")
        refs(row["issue_ids"], issue_ids, path + ".issue_ids")
        refs(row["evidence_ids"], evidence_ids, path + ".evidence_ids", gaps)
        if row["status"] != "covered":
            gaps.append(path + ": coverage is not covered")

    review = data["review"]
    refs(review["criteria"], set(CRITERIA), "$.review.criteria")
    refs(review["issue_ids"], issue_ids, "$.review.issue_ids")
    refs(review["evidence_ids"], evidence_ids, "$.review.evidence_ids", gaps)
    if review["verdict"] != "pending":
        text(review["rationale"], "$.review.rationale", gaps)
    if review["verdict"] == "suitable":
        require(set(CRITERIA).issubset(set(review["criteria"])), "$.review.criteria", "all W1-W7 qualitative criteria required", gaps)
        require(bool(review["evidence_ids"]), "$.review.evidence_ids", "qualitative review requires actual rendered evidence", gaps)
        require(not review["issue_ids"], "$.review.issue_ids", "suitable qualitative review cannot retain issues", gaps)
        require(review["content_hash"] == content_hash, "$.review.content_hash", "stale qualitative review content hash", gaps)
        require(review["knowledge_hash"] == knowledge_hash, "$.review.knowledge_hash", "stale qualitative review knowledge hash", gaps)
    else:
        gaps.append("$.review.verdict: suitable qualitative review required")
        if review["verdict"] in ("needs_work", "insufficient_evidence"):
            require(bool(review["issue_ids"]), "$.review.issue_ids", "failed review needs issue", gaps)

    for n, entry in enumerate(data["history"]):
        text(entry["change"], f"$.history[{n}].change")
        text(entry["reason"], f"$.history[{n}].reason")

    ready = not errors and not gaps
    completion = list(gaps)
    target_verdicts = Counter(target["gate"]["verdict"] for target in data["targets"])
    require(all(target["gate"]["verdict"] == "accept_ai" and target["status"] == "accept_ai" for target in data["targets"]), "$.targets", "all targets must accept_ai", completion)
    require(not any(issue["blocking"] and not planning_context.closed(issue) for issue in data["issues"]), "$.issues", "blocking issues remain", completion)
    confirmation = data["confirmation"]
    require(confirmation["confirmed"], "$.confirmation", "current planner confirmation missing", completion)
    if confirmation["confirmed"]:
        text(confirmation["turn_id"], "$.confirmation.turn_id", completion)
        text(confirmation["statement"], "$.confirmation.statement", completion)
        require(confirmation["content_hash"] == content_hash, "$.confirmation", "stale confirmation content hash", completion)
        require(confirmation["review_hash"] == review_hash, "$.confirmation", "stale confirmation review hash", completion)
        require(confirmation["input_hash"] == input_hash, "$.confirmation", "stale confirmation input hash", completion)
        require(confirmation["knowledge_hash"] == knowledge_hash, "$.confirmation", "stale confirmation knowledge hash", completion)
    require(data["status"] == "complete", "$.status", "not complete", completion)
    complete = ready and not completion
    if data["status"] == "complete" and not complete:
        errors.append("$.status: complete is inconsistent with current validation")
    report.update(
        valid=not errors,
        ready_for_confirmation=ready,
        complete=complete,
        errors=errors,
        completion_errors=completion,
        coverage=coverage_metrics,
        target_gate_verdicts=dict(target_verdicts),
        upstream_inventory={target_id: {kind: len(values) for kind, values in inventory.items()} for target_id, inventory in upstream_by_target.items()},
        next_actions=[{"id": item["id"], "kind": item["action"]["kind"], "prompt": item["action"]["prompt"]} for item in data["issues"]],
    )
    return report


def init_from_screen_behavior(output, input_path=None):
    output = Path(output)
    data = load_json(TEMPLATE)
    data["case_id"] = re.sub(r"[^a-z0-9]+", "-", output.parent.name.lower()).strip("-") or "untitled"
    if input_path is not None:
        source_path = Path(input_path).resolve()
        source = load_json(source_path)
        if source.get("schema_version") != 3:
            raise ValueError("design-system wireframes require current schema v3 screen behavior input")
        source_report = screen_behavior.validate(source)
        if not source_report["complete"]:
            raise ValueError("screen behavior must be complete and currently confirmed")
        content_hash, review_hash = screen_behavior.fingerprints(source)
        data["title"] = source["title"] + " Design System Wireframes"
        data["input_binding"]["screen_behavior"] = {
            "path": str(source_path),
            "content_hash": content_hash,
            "review_hash": review_hash,
            "confirmation_turn_id": source["confirmation"]["turn_id"],
            "project_id": source["evidence_status"]["project_id"],
            "observed_revision": source["evidence_status"]["observed_revision"],
        }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return data


def esc(value):
    return html.escape(str(value)).replace("|", "&#124;").replace("\n", " ")


def render(data, report=None):
    report = report or validate(data)
    lines = [
        f"# Design System Wireframe — {esc(data['title'])}",
        "",
        f"사례: {esc(data['case_id'])} · 상태: {esc(data['status'])} · schema: {data['schema_version']}",
        "",
        "## 입력과 지식 팩",
        "",
        f"- 화면 동작: {esc(data['input_binding']['screen_behavior']['path'])}",
        f"- 입력 해시: {esc(data['input_binding']['screen_behavior']['content_hash'])}",
        f"- 지식 팩: {esc(data['knowledge_binding']['pack_id'])} {esc(data['knowledge_binding']['version'])}",
        "",
        "## 대상",
        "",
    ]
    for target in data["targets"]:
        lines += [
            f"### {esc(target['id'])} · {esc(target['screen_id'])}",
            "",
            f"상태: {target['status']} · gate: {target['gate']['verdict']} · run: {esc(target['run_id'])}",
            "",
            f"Spec: {esc(target['spec_path'])}",
            f"Renderer: {esc(target['renderer_path'])}",
            "",
            "| 범위 | 개수 |",
            "|---|---:|",
        ]
        for label, field in (("screens", "screen_ids"), ("elements", "element_ids"), ("state axes", "state_axis_ids"), ("transitions", "transition_ids"), ("render cases", "render_case_ids"), ("handoffs", "design_handoff_ids")):
            lines.append(f"| {label} | {len(target['required_coverage'][field])} |")
        lines += ["", "디자인 결정: " + ", ".join(f"{stage}={target['design_decisions'][stage]['status']}" for stage in REQUIRED_DECISION_STAGES), ""]
    lines += ["## 검증", ""]
    for metric in report["coverage"]:
        lines.append(f"- {metric['id']}: {metric['numerator']}/{metric['denominator']} · {metric['status']}")
    lines += [
        f"- 정성 검토: {data['review']['verdict']}",
        f"- target gate: {', '.join(f'{key} {value}' for key, value in sorted(report['target_gate_verdicts'].items())) or '없음'}",
        f"- 구조 유효: {report['valid']} · 확인 준비: {report['ready_for_confirmation']} · 완료: {report['complete']}",
        "",
    ]
    for error in report["errors"] + report["completion_errors"]:
        lines.append("- " + esc(error))
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init")
    init.add_argument("path", type=Path)
    init.add_argument("--input", type=Path)
    validate_parser = commands.add_parser("validate")
    validate_parser.add_argument("path", type=Path)
    validate_parser.add_argument("--require-ready", action="store_true")
    validate_parser.add_argument("--require-complete", action="store_true")
    render_parser = commands.add_parser("render")
    render_parser.add_argument("path", type=Path)
    render_parser.add_argument("-o", "--output", type=Path)
    fingerprint_parser = commands.add_parser("fingerprint")
    fingerprint_parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "init":
            init_from_screen_behavior(args.path, args.input)
            result, code = {"created": True, "path": str(args.path.resolve())}, 0
        elif args.command == "validate":
            result = validate(load_json(args.path), args.path)
            code = int(not result["valid"] or (args.require_ready and not result["ready_for_confirmation"]) or (args.require_complete and not result["complete"]))
        elif args.command == "fingerprint":
            content_hash, review_hash = fingerprints(load_json(args.path))
            result, code = {"content_hash": content_hash, "review_hash": review_hash}, 0
        else:
            data = load_json(args.path)
            body = render(data, validate(data, args.path))
            if args.output:
                if args.output.resolve() == args.path.resolve():
                    raise ValueError("render output must differ from JSON input")
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(body, encoding="utf-8")
                result, code = {"path": str(args.output.resolve())}, 0
            else:
                print(body, end="")
                return 0
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, RecursionError) as exc:
        result, code = {"error": str(exc)}, 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
