import json
import subprocess
import copy
import tempfile
import unittest
from pathlib import Path

from pipeline.interface import create_run, get_run, resume_run, get_artifact


ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PACK_ROOT = ROOT.parent / "design-knowledge"


def packet():
    return {
        "schema_version": 1,
        "source": {
            "path": "/case/screen-behavior.json",
            "case_id": "python-wrapper",
            "project_id": "project",
            "observed_revision": "rev",
            "content_hash": "a" * 64,
            "review_hash": "b" * 64,
            "confirmation_turn_id": "turn",
            "input_hashes": {},
            "knowledge_binding": {"pack_id": "heroines", "version": "2026-09-09"},
        },
        "knowledge_binding": {"pack_id": "heroines", "version": "2026-09-09"},
        "targets": [{
            "target_id": "screen",
            "screen_id": "screen",
            "task": "Wireframe screen",
            "purpose": "Test wrapper",
            "audience": ["member"],
            "nodes": [{"element_id": "root", "parent_id": None, "name": "Root", "semantic_type": "region", "purpose": "Root", "information_refs": [], "action_refs": [], "repetition": "none", "source_ids": ["U1"], "decision_ids": []}],
            "states": [{"render_case_id": "default", "title": "Default", "scenario_ids": [], "sample_items": [], "sample_groups": [], "state_assignments": [], "visible_information": [], "available_actions": [], "blocked_actions_with_reasons": [], "focus_expectation": "", "equivalence_rationale": "Default"}],
            "flows": [],
            "constraints": [],
            "interaction_rules": [],
            "inventory_links": [],
            "design_handoffs": [{"handoff_id": "handoff", "element_ids": ["root"], "semantic_pattern": "Root", "required_state_refs": [], "render_case_ids": ["default"], "interaction_refs": [], "accessibility_expectations": [], "candidate_design_system_ref": "role:account", "mapping_status": "mapped", "gap": "", "owner": "test"}],
            "traceability": {"source_ids": ["U1"], "decision_ids": []},
        }],
        "cross_screen_links": [],
        "inventory_links": [],
        "coverage_manifest": {"screens": ["screen"], "elements": ["root"], "render_cases": ["default"], "transitions": [], "flow_transitions": [], "cross_screen_links": [], "design_handoffs": ["handoff"], "source_ids": ["U1"], "decision_ids": []},
    }


def write_design_decisions(run_dir, mutate=None):
    meta = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    decisions = {
        "target_id": meta["packet"]["targets"][0]["target_id"],
        "input_hash": meta["packet"]["source"]["content_hash"],
        "knowledge_hash": meta["knowledge"]["hash"],
        "stages": {
            "roles": {"status": "verified", "rationale": "Role follows packet handoff.", "evidence": ["runtime-playwright"]},
            "reference_transfer": {"status": "verified", "rationale": "Rendered capture carries the transfer.", "evidence": ["captures/default-mobile.png"]},
            "hierarchy": {"status": "verified", "rationale": "DOM hierarchy is checked by runtime.", "evidence": ["runtime-playwright"]},
            "layout": {"status": "verified", "rationale": "Layout is visible in capture.", "evidence": ["captures/default-mobile.png"]},
            "components": {"status": "verified", "rationale": "Surface adapter is exercised.", "evidence": ["runtime-playwright"]},
            "tokens": {"status": "verified", "rationale": "Template token is rendered.", "evidence": ["captures/default-mobile.png"]},
        },
    }
    if mutate:
        mutate(decisions)
    (run_dir / "design-decisions.json").write_text(json.dumps(decisions, ensure_ascii=False, indent=2), encoding="utf-8")


class InterfaceTest(unittest.TestCase):
    def test_python_interface_creates_resumes_and_reads_artifacts(self):
        with tempfile.TemporaryDirectory(prefix="ba-wireframe-py-") as tmp:
            run_id = create_run("case:python-wrapper", packet(), "heroines/2026-09-09", tmp, PACK_ROOT)
            status = get_run(run_id, tmp)

            self.assertEqual(status["status"], "prepared")
            self.assertEqual(status["source"]["case_id"], "python-wrapper")

            write_design_decisions(Path(tmp) / run_id)
            resumed = resume_run(run_id, tmp, PACK_ROOT)
            gate = get_artifact(run_id, "gate", tmp)

            self.assertEqual(resumed["status"], "needs_ai_review")
            self.assertEqual(gate["verdict"], "insufficient_evidence")
            self.assertEqual(gate["baFinalComplete"], False)

    def test_python_interface_engine_rejects_invalid_authored_decisions(self):
        cases = [
            lambda decisions: decisions["stages"]["roles"].pop("rationale"),
            lambda decisions: decisions["stages"]["roles"].update({"evidence": []}),
            lambda decisions: decisions["stages"]["roles"].update({"evidence": ["ghost-evidence"]}),
        ]
        for mutate in cases:
            with tempfile.TemporaryDirectory(prefix="ba-wireframe-py-") as tmp:
                run_id = create_run("case:python-wrapper", packet(), "heroines/2026-09-09", tmp, PACK_ROOT)
                write_design_decisions(Path(tmp) / run_id, mutate)
                with self.assertRaises(subprocess.CalledProcessError):
                    resume_run(run_id, tmp, PACK_ROOT)

    def test_python_interface_rejects_stale_ai_review_hashes(self):
        with tempfile.TemporaryDirectory(prefix="ba-wireframe-py-") as tmp:
            run_id = create_run("case:python-wrapper", packet(), "heroines/2026-09-09", tmp, PACK_ROOT)
            run_dir = Path(tmp) / run_id
            write_design_decisions(run_dir)
            resume_run(run_id, tmp, PACK_ROOT)
            runtime = get_artifact(run_id, "runtime", tmp)
            meta = get_artifact(run_id, "run", tmp)
            spec_hash = get_artifact(run_id, "freeze", tmp)["artifacts"]["design-spec.template.json"]["sha256"]
            review = {
                "verdict": "accept_ai",
                "input_hash": "c" * 64,
                "knowledge_hash": meta["knowledge"]["hash"],
                "spec_hash": spec_hash,
                "renderer_hash": runtime["captures"][0]["sourceHash"],
                "capture_hashes": {row["path"]: row["imageHash"] for row in runtime["captures"]},
                "viewedImages": [row["path"] for row in runtime["captures"]],
                "viewed_captures": [{"path": row["path"], "hash": row["imageHash"], "observations": ["reviewed"]} for row in runtime["captures"]],
                "axes": ["accessibility"],
                "criteria": {f"W{i}": {"observation": "checked", "evidence": [runtime["captures"][0]["path"]]} for i in range(1, 8)},
                "findings": [],
            }
            (run_dir / "ai-review.json").write_text(json.dumps(review), encoding="utf-8")
            subprocess.run(["node", str(PACKAGE_ROOT / "src" / "cli.mjs"), "gate", "--run-dir", str(run_dir)], cwd=PACKAGE_ROOT, check=True, capture_output=True, text=True)
            self.assertEqual(get_artifact(run_id, "gate", tmp)["verdict"], "invalid")

    def test_python_interface_rejects_unsafe_run_ids_and_artifacts(self):
        with tempfile.TemporaryDirectory(prefix="ba-wireframe-py-") as tmp:
            run_id = create_run("case:python-wrapper", packet(), "heroines/2026-09-09", tmp, PACK_ROOT)

            with self.assertRaises(ValueError):
                get_run("../escape", tmp)
            with self.assertRaises(ValueError):
                resume_run("/tmp/escape", tmp, PACK_ROOT)
            with self.assertRaises(ValueError):
                get_artifact(run_id, "../run", tmp)
            with self.assertRaises(ValueError):
                get_artifact(run_id, "not-engine-artifact", tmp)


if __name__ == "__main__":
    unittest.main()
