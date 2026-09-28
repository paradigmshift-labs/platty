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
    "inventory/runtime-captures.json": "Runtime captures of the analyzed application",
}
# Built into the pack only when the design system provides them.
OPTIONAL_SOURCE_FILES = {
    "figma/component-map.json": "Design-system component to Figma library component map",
}
FIGMA_MAP_STATUSES = ("mapped", "primitive", "unmapped")


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
        refs.extend(self.build_runtime_references())
        return refs

    def build_runtime_references(self):
        """Screens observed in the running app.

        A capture shows what the code produced, so it is evidence of the current build,
        never a design approval. Rows the capture run could not render stay in the source
        file with their reason: the pack carries the ones that rendered, and the gap stays
        readable upstream instead of vanishing here.
        """
        document = self.read_json("inventory/runtime-captures.json")
        revision = document.get("source_revision", "")
        limitation = document.get("limitation", "")
        refs = []
        for row in document.get("rows", []):
            if not row.get("included") or not row.get("screenshot") or not row.get("role"):
                continue
            copied = self.copy_reference(row["screenshot"], f"runtime/{row['id'].split(':', 1)[-1]}")
            if not copied:
                continue
            refs.append({
                "id": row["id"],
                "role": row["role"],
                "authority": "runtime-capture",
                "revision": revision,
                "limitation": limitation,
                "route": row.get("route", ""),
                "state": row.get("state", "default"),
                **copied,
            })
        return refs

    def build(self):
        sources = {**SOURCE_FILES, **{path: authority for path, authority in OPTIONAL_SOURCE_FILES.items()
                                      if (self.source / path).exists()}}
        self.source_hashes = {path: sha256(self.source / path) for path in sources}
        figma = self.read_figma_map() if "figma/component-map.json" in sources else None
        self.dest.mkdir(parents=True, exist_ok=True)
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
            "selectionPolicy": "Normalize all tokens, component contracts/state map, all 23 role rules, all recipe rules, required principles/usability, high-confidence referenced images, and runtime captures of screens that rendered. Archives, experiments, galleries, raw low-confidence references, captures that did not render, and historical runs are excluded.",
            "sources": [
                {
                    "path": path,
                    "sha256": self.source_hashes[path],
                    "revision": self.source_hashes[path],
                    "authority": authority,
                    "limitation": "Normalized for BA wireframe engine use; upstream path is not a runtime dependency.",
                }
                for path, authority in sources.items()
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
                    ("references", "inventory/runtime-captures.json"),
                ]
            ],
        }
        if figma is not None:
            pack["figma"] = figma
            pack["rowProvenance"].append({
                "collection": "figma",
                "sourcePath": "figma/component-map.json",
                "revision": self.source_hashes["figma/component-map.json"],
                "authority": OPTIONAL_SOURCE_FILES["figma/component-map.json"],
                "limitation": "Which Figma component draws a code component, as the design system states it.",
            })
        orphans = recipe_role_gaps(pack)
        if orphans:
            # A rule whose role does not exist can never fire; shipping it hides the gap.
            raise SystemExit(
                "recipe rules name roles that do not exist: " + ", ".join(orphans)
                + "\nrefile them as state rules of an existing role, or add the role, in "
                + "recipes/validation-input.json")
        (self.dest / "upstream-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (self.dest / "pack.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


    def read_figma_map(self):
        """The design system's own answer to which Figma component draws each code component.

        It belongs upstream: the BA export only reads it. A malformed map fails the build here,
        where its owner can fix it, instead of surfacing as a wrong instance in someone's file.
        """
        mapping = self.read_json("figma/component-map.json")
        errors = figma_map_errors(mapping)
        if errors:
            raise SystemExit("figma/component-map.json is malformed:\n" + "\n".join(errors))
        return {key: mapping.get(key) or {} for key in ("library", "components", "tokens")}


def figma_map_errors(mapping):
    errors = []
    if mapping.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    components = mapping.get("components")
    if not isinstance(components, dict):
        return errors + ["components must be an object keyed by component name"]
    for name, entry in components.items():
        status = entry.get("status") if isinstance(entry, dict) else None
        for field in ("variant_props", "state_props"):
            if isinstance(entry, dict) and not isinstance(entry.get(field) or {}, dict):
                errors.append(f"{name}: {field} must be an object")
        if status not in FIGMA_MAP_STATUSES:
            errors.append(f"{name}: status must be one of {', '.join(FIGMA_MAP_STATUSES)}")
        elif status == "mapped" and not (entry.get("component_key") or entry.get("component_set_key")):
            errors.append(f"{name}: mapped needs component_key or component_set_key")
        elif status != "mapped" and not str(entry.get("reason", "")).strip():
            errors.append(f"{name}: say why there is no library component")
    if any(isinstance(entry, dict) and entry.get("status") == "mapped" for entry in components.values()) \
            and not str((mapping.get("library") or {}).get("file_key", "")).strip():
        errors.append("library.file_key: a mapped component needs the library it comes from")
    tokens = mapping.get("tokens") or {}
    if not isinstance(tokens, dict):
        return errors + ["tokens must be an object keyed by token name"]
    for token, entry in tokens.items():
        if not isinstance(entry, dict) or not str(entry.get("variable_key", "")).strip():
            errors.append(f"tokens.{token}: variable_key is required")
    return errors


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
