import json
import re
import subprocess
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
CLI = PACKAGE_ROOT / "src" / "cli.mjs"
OPAQUE_RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{7,80}$")
ARTIFACT_IDS = {
    "ai-review",
    "design-decisions",
    "design-spec",
    "design-spec.template",
    "freeze",
    "gate",
    "packet",
    "run",
    "runtime",
    "spec-validation",
    "status",
    "traceability",
    "traceability.template",
}


def _run(command, run_dir, pack_root=None, input_file=None):
    args = ["node", str(CLI), command]
    if command == "prepare":
        args.extend(["--output-root", str(run_dir), "--input", str(input_file), "--pack-root", str(pack_root)])
    else:
        args.extend(["--run-dir", str(run_dir)])
    if input_file is not None and command != "prepare":
        args.extend(["--input", str(input_file)])
    if pack_root is not None and command != "prepare":
        args.extend(["--pack-root", str(pack_root)])
    args.extend(["--json", "full"])
    result = subprocess.run(args, cwd=PACKAGE_ROOT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def _read(path):
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def _contained_path(root, *parts):
    root = Path(root).resolve()
    path = root.joinpath(*parts).resolve()
    if path != root and root not in path.parents:
        raise ValueError("path outside output root")
    return path


def _run_dir(output_root, run_id):
    if not OPAQUE_RUN_ID.fullmatch(run_id):
        raise ValueError("opaque run id required")
    return _contained_path(output_root, run_id)


def _artifact_name(artifact_id):
    name = artifact_id[:-5] if artifact_id.endswith(".json") else artifact_id
    if name not in ARTIFACT_IDS:
        raise ValueError("unknown engine artifact id")
    return f"{name}.json"


def create_run(case_ref, screen_behavior_binding, knowledge_pack_version, output_root, knowledge_pack_root):
    target = dict(screen_behavior_binding)
    target["knowledge_binding"] = {"pack_id": "heroines", "version": knowledge_pack_version.split("/")[-1]}
    target.setdefault("source", {})["case_id"] = case_ref.replace("case:", "")
    root = Path(output_root)
    root.mkdir(parents=True, exist_ok=True)
    input_file = root / "packet-input.json"
    input_file.write_text(json.dumps(target, ensure_ascii=False), encoding="utf-8")
    prepared = _run("prepare", root, knowledge_pack_root, input_file)
    return prepared["runId"]


def get_run(run_id, output_root):
    return _read(_run_dir(output_root, run_id) / "status.json")


def resume_run(run_id, output_root, knowledge_pack_root):
    run_dir = _run_dir(output_root, run_id)
    _run("spec", run_dir)
    _run("runtime", run_dir)
    _run("freeze", run_dir)
    _run("gate", run_dir)
    return get_run(run_id, output_root)


def get_artifact(run_id, artifact_id, output_root):
    return _read(_run_dir(output_root, run_id) / _artifact_name(artifact_id))
