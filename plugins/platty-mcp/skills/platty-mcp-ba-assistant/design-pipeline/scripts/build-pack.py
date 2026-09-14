#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = Path(os.environ.get("BA_WORKSPACE") or Path.cwd()).resolve()
DEFAULT_VERSION = "default/2026-09-09"


SOURCE_FILES = {
    "tokens/tokens.json": "HDS semantic tokens",
    "expansion/component-contracts.json": "Component source and interface contracts",
    "components/props.json": "Declared component props",
    "components/state-map.json": "Human component state observations",
    "expansion/ui-source-index.json": "Source path and interface hash index",
    "expansion/type-rules.json": "Screen role rules",
    "recipes/validation-input.json": "Validation recipe rules",
    "design/required/principles.json": "Required design principles",
    "design/required/usability.json": "Nielsen usability checks",
    "inventory/figma-frames.jsonl": "Figma frame inventory",
    "inventory/expanded-frames.json": "Expanded high-confidence frame inventory",
    "expansion/additional-figma-evidence.json": "Additional Figma evidence",
}


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def object_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


class PackBuilder:
    def __init__(self, source, dest, version):
        self.source = source.resolve()
        self.dest = dest.resolve()
        self.version = version
        self.source_hashes = {}

    def read_json(self, path):
        return json.loads((self.source / path).read_text(encoding="utf-8"))

    def read_jsonl(self, path):
        return [json.loads(line) for line in (self.source / path).read_text(encoding="utf-8").splitlines() if line.strip()]

    def read_knowledge_entries(self):
        """Which components a wireframe may use.

        A contract in componentContracts is not a licence to use the component: the
        engine also needs the state axes it can express, and that is a human judgement
        no parser produces. The list lives in data so promoting a component is an edit,
        not a code change.
        """
        entries = json.loads((PLUGIN_ROOT / "component-knowledge.json")
                             .read_text(encoding="utf-8"))["entries"]
        for entry in entries:
            source_path = entry["row"]["sourcePath"]
            if source_path not in SOURCE_FILES:
                raise SystemExit(
                    f"component knowledge {entry['row']['ref']} cites {source_path}, which the "
                    "pack does not build from; revision and authority cannot be recorded for it")
        return entries

    def component_row(self, row, origin):
        source_path = row["sourcePath"]
        enriched = {
            **row,
            "revision": self.source_hashes[source_path],
            "authority": (
                f"BA-authored adapter normalized from {SOURCE_FILES[source_path]}"
                if origin == "ba-authored-adapter"
                else SOURCE_FILES[source_path]
            ),
            "origin": origin,
        }
        enriched["hash"] = object_hash(enriched)
        return enriched

    def copy_reference(self, source_path, prefix):
        src = self.source / source_path
        if not src.exists():
            return None
        local = Path("references") / prefix / src.name
        dst = self.dest / local
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        return {
            "localPath": local.as_posix(),
            "sourcePath": source_path,
            "sha256": sha256(dst),
        }

    def inventory_screenshot(self, row):
        file_key = row.get("file_key")
        node_id = (row.get("node_id") or "").replace(":", "-")
        candidate = Path("references") / "figma" / file_key / node_id / "screenshot.png"
        return candidate.as_posix() if (self.source / candidate).exists() else None

    def build_references(self):
        refs = []
        for row in self.read_jsonl("inventory/figma-frames.jsonl"):
            if row.get("match_status") == "matched" and row.get("match_confidence") == "high":
                screenshot = self.inventory_screenshot(row)
                copied = self.copy_reference(screenshot, f"figma/{row['file_key']}/{row['node_id'].replace(':', '-')}") if screenshot else None
                if copied:
                    refs.append({
                        "id": row["frame_id"],
                        "role": row.get("node_name", ""),
                        "authority": "high-confidence-figma-frame",
                        "revision": row.get("source_revision", ""),
                        "limitation": row.get("selection_reason") or "High-confidence match; still reference evidence, not a product requirement.",
                        **copied,
                    })
        for row in self.read_json("inventory/expanded-frames.json"):
            if row.get("match_status") == "matched" and row.get("match_confidence") == "high":
                copied = self.copy_reference(row["screenshot"], f"expanded/{row.get('role', 'unknown')}/{Path(row['screenshot']).parent.name}")
                if copied:
                    refs.append({
                        "id": f"expanded:{row.get('role')}:{Path(row['screenshot']).parent.name}",
                        "role": row.get("role", ""),
                        "authority": "high-confidence-expanded-frame",
                        "revision": row.get("source_revision", ""),
                        "limitation": "Expanded frame is copied as design reference evidence only.",
                        **copied,
                    })
        return refs

    def build(self):
        self.dest.mkdir(parents=True, exist_ok=True)
        self.source_hashes = {path: sha256(self.source / path) for path in SOURCE_FILES}
        source_identity = object_hash({"sources": self.source_hashes})
        tokens = self.read_json("tokens/tokens.json")
        component_contracts = self.read_json("expansion/component-contracts.json")
        props = self.read_json("components/props.json")
        state_map = self.read_json("components/state-map.json")
        roles = self.read_json("expansion/type-rules.json")
        recipes = self.read_json("recipes/validation-input.json")
        principles = self.read_json("design/required/principles.json")
        usability = self.read_json("design/required/usability.json")
        references = self.build_references()
        component_knowledge = [
            self.component_row(entry["row"], entry["origin"])
            for entry in self.read_knowledge_entries()
        ]

        manifest = {
            "packVersion": self.version,
            "sourceIdentity": source_identity,
            "createdFor": "BA design-system wireframe PoC Task 3",
            "selectionPolicy": "Normalize all tokens, component contracts/state map, all 23 role rules, all recipe rules, required principles/usability, and high-confidence referenced images. Archives, experiments, galleries, raw low-confidence references, and historical runs are excluded.",
            "sources": [
                {
                    "path": path,
                    "sha256": self.source_hashes[path],
                    "revision": self.source_hashes[path],
                    "authority": authority,
                    "limitation": "Normalized for BA wireframe engine use; upstream path is not a runtime dependency.",
                }
                for path, authority in SOURCE_FILES.items()
            ],
            "excluded": ["inputs/", "experiments/", "handoff/", "runtime galleries", "coverage captures", "historical design runs", "low-confidence Figma frames"],
        }
        pack = {
            "version": self.version,
            "tokens": tokens,
            "componentContracts": component_contracts,
            "componentProps": props,
            "componentStateMap": state_map,
            "componentKnowledge": component_knowledge,
            "roles": roles,
            "recipeRules": recipes,
            "principles": principles,
            "usability": usability,
            "references": references,
            "rowProvenance": [
                {
                    "collection": collection,
                    "sourcePath": source_path,
                    "revision": self.source_hashes[source_path],
                    "authority": SOURCE_FILES[source_path],
                    "limitation": "Rows inherit the source limitation from upstream-manifest.json.",
                }
                for collection, source_path in [
                    ("tokens", "tokens/tokens.json"),
                    ("componentContracts", "expansion/component-contracts.json"),
                    ("componentProps", "components/props.json"),
                    ("componentStateMap", "components/state-map.json"),
                    ("roles", "expansion/type-rules.json"),
                    ("recipeRules", "recipes/validation-input.json"),
                    ("principles", "design/required/principles.json"),
                    ("usability", "design/required/usability.json"),
                    ("references", "inventory/figma-frames.jsonl"),
                ]
            ],
        }
        orphans = recipe_role_gaps(pack)
        if orphans:
            # A rule whose role does not exist can never fire; shipping it hides the gap.
            raise SystemExit(
                "recipe rules name roles that do not exist: " + ", ".join(orphans)
                + "\nrefile them as state rules of an existing role, or add the role, in "
                + "recipes/validation-input.json")
        (self.dest / "upstream-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (self.dest / "pack.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def recipe_role_gaps(pack):
    """Recipe rules that name no applicable screen role.

    A recipe's ``type`` may be a state role (for example, a blocked or
    waiting state) rather than a top-level screen role.  Those recipes remain
    usable only when they explicitly name the screen roles they refine.
    """
    roles = {row["type"] for row in pack.get("roles", [])}
    gaps = set()
    for row in pack.get("recipeRules", []):
        applies_to = row.get("appliesTo")
        if applies_to is None:
            if row["type"] not in roles:
                gaps.add(row["type"])
            continue
        if not isinstance(applies_to, list) or not applies_to:
            gaps.add(row["type"])
            continue
        gaps.update(role for role in applies_to if role not in roles)
    return sorted(gaps)


def parse_args():
    parser = argparse.ArgumentParser(description="Build the BA design knowledge pack from an explicit upstream source root.")
    parser.add_argument("--source-root", default=os.environ.get("BA_DESIGN_PIPELINE_SOURCE_ROOT"), help="Upstream design-pipeline source root")
    parser.add_argument("--dest", help="Output directory for pack.json and upstream-manifest.json")
    parser.add_argument("--version", default=DEFAULT_VERSION, help="Pack version as scope/release")
    args = parser.parse_args()
    if not args.source_root:
        parser.error("--source-root or BA_DESIGN_PIPELINE_SOURCE_ROOT is required")
    source = Path(args.source_root).expanduser().resolve()
    if not source.exists() or not source.is_dir():
        parser.error(f"source root does not exist: {source}")
    missing = [path for path in SOURCE_FILES if not (source / path).exists()]
    if missing:
        parser.error("source root missing required files: " + ", ".join(missing))
    if "/" not in args.version or ".." in args.version:
        parser.error("--version must be scoped as name/version")
    dest = Path(args.dest).expanduser().resolve() if args.dest else WORKSPACE_ROOT / "design-knowledge" / Path(args.version)
    return source, dest, args.version


def main():
    source, dest, version = parse_args()
    PackBuilder(source, dest, version).build()


if __name__ == "__main__":
    main()
