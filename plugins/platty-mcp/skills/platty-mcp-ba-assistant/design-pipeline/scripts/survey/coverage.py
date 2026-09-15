#!/usr/bin/env python3
"""Design pack survey — compare extracted screen facts with the current pack and Platty specs.

Answers, for one scope of screens: which screens the pack has evidence for, which
components the wireframe engine could actually draw, and which colors used in code
resolve to a pack token.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def flatten_tokens(node, prefix=""):
    """DTCG tree -> {dotted name: value}."""
    out = {}
    if isinstance(node, dict):
        if "$value" in node:
            out[prefix] = node["$value"]
            return out
        for key, value in node.items():
            if key.startswith("$"):
                continue
            out.update(flatten_tokens(value, f"{prefix}.{key}" if prefix else key))
    return out


ALIAS = re.compile(r"^\{([^}]+)\}$")


def resolve(name, tokens, seen=()):
    value = tokens.get(name)
    if not isinstance(value, str):
        return value
    match = ALIAS.match(value.strip())
    if not match or name in seen:
        return value
    return resolve(match.group(1), tokens, seen + (name,))


def norm_hex(value):
    # DTCG 2025.10 color: {"colorSpace": "srgb", "components": [r, g, b], "alpha": 1}
    if isinstance(value, dict) and value.get("colorSpace") == "srgb":
        components = value.get("components") or []
        if len(components) >= 3 and all(isinstance(c, (int, float)) for c in components[:3]):
            return "#" + "".join(f"{round(c * 255):02x}" for c in components[:3])
        return None
    if not isinstance(value, str):
        return None
    v = value.strip().lower()
    if not v.startswith("#"):
        return None
    if len(v) == 4:
        v = "#" + "".join(c * 2 for c in v[1:])
    if len(v) == 9:  # #rrggbbaa -> compare on rgb, alpha noted separately
        v = v[:7]
    return v if len(v) == 7 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--facts", required=True, help="facts directory from extract-screens.mjs")
    ap.add_argument("--pack", required=True, help="pack.json of the design knowledge pack")
    ap.add_argument("--platty-screens", required=True, help="upstream expansion/app-screens.json")
    ap.add_argument("--upstream-screens", required=True, help="upstream inventory/screens.jsonl")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    facts = load(Path(args.facts) / "screens.json")
    components = load(Path(args.facts) / "components.json")["components"]
    theme = load(Path(args.facts) / "theme.json")
    pack = load(args.pack)
    platty_rows = load(args.platty_screens)
    upstream_rows = [json.loads(line) for line in Path(args.upstream_screens).read_text(encoding="utf-8").splitlines() if line.strip()]

    routes = facts["routes"]
    route_paths = {r["routePath"] for r in routes}

    # --- Platty spec coverage -------------------------------------------------
    platty_by_route = {}
    for row in platty_rows:
        platty_by_route.setdefault(row.get("route"), []).append(row)
    upstream_by_route = {}
    for row in upstream_rows:
        upstream_by_route.setdefault(row.get("route_path"), []).append(row)

    # --- pack tokens ----------------------------------------------------------
    tokens = flatten_tokens(pack["tokens"])
    token_hex = {}
    for name in tokens:
        value = norm_hex(resolve(name, tokens))
        if value:
            token_hex.setdefault(value, []).append(name)
    theme_hex = {}
    for name, value in theme["colors"].items():
        value = norm_hex(value)
        if value:
            theme_hex.setdefault(value, []).append(name)

    # --- pack component knowledge --------------------------------------------
    promoted = {row["component"] for row in pack["componentKnowledge"]}
    promoted_norm = {c.replace(" ", "").lower() for c in promoted}
    contracts = pack["componentContracts"]["components"]
    contract_names = set()
    contract_by_path = {}
    for row in contracts if isinstance(contracts, list) else contracts.values():
        if isinstance(row, dict):
            name = row.get("name") or row.get("component") or row.get("id")
            path = row.get("path") or row.get("sourcePath") or row.get("file")
            if name:
                contract_names.add(name)
            if path:
                contract_by_path[path] = name or path
    pack_roles = {row["type"] for row in pack["roles"]}
    pack_reference_roles = Counter(row.get("role", "") for row in pack["references"])

    # --- per route ------------------------------------------------------------
    per_route = []
    for route in routes:
        used = [c for c in route["components"] if c["layer"] in ("hds", "widget", "component", "feature", "page-module", "local", "shared")]
        hds_used = {c["name"].replace("Icon", "") if c["layer"] == "hds" and c["name"].endswith("Icon") else c["name"] for c in used if c["layer"] == "hds"}
        drawable = {n for n in hds_used if n.replace(" ", "").lower() in promoted_norm}
        arbitrary = route["styles"]["arbitraryColors"]
        mapped = [[h, n, token_hex.get(norm_hex(h), []), theme_hex.get(norm_hex(h), [])] for h, n in arbitrary]
        platty = platty_by_route.get(route["routePath"], [])
        upstream = upstream_by_route.get(route["routePath"], [])
        per_route.append({
            "routePath": route["routePath"],
            "entry": route["entry"],
            "screenSpecificFiles": route["files"]["screenSpecific"],
            "ownedLines": route["files"]["ownedLines"],
            "componentsUsed": len(route["components"]),
            "hdsComponentsUsed": sorted(hds_used),
            "hdsDrawableByPack": sorted(drawable),
            "hdsNotInPack": sorted(hds_used - drawable),
            "pageLocalComponents": len([c for c in route["components"] if c["layer"] in ("page-module", "local")]),
            "apiCount": len(route["api"]),
            "apiPaths": sorted({p for a in route["api"] for p in a["paths"]}),
            "states": {k: len(v) for k, v in route["states"]["buckets"].items()},
            "conditionalRenders": route["states"]["conditionalRenders"],
            "copyStrings": len(route["copy"]["owned"]),
            "classCount": route["styles"]["classCount"],
            "themeColorClasses": route["styles"]["byKind"].get("theme-color", 0),
            "arbitraryColorClasses": route["styles"]["byKind"].get("arbitrary-color", 0),
            "arbitraryColorsUnmapped": sorted({h for h, _n, tok, _th in mapped if not tok}),
            "arbitraryColorsMappedToToken": sorted({h for h, _n, tok, _th in mapped if tok}),
            "platty": [{"specId": p.get("id"), "epic": p.get("epic"), "role": p.get("role"), "excluded": p.get("excluded", False), "title": p.get("title")} for p in platty],
            "inUpstreamScreenInventory": [{"specId": u.get("spec_id"), "role": u.get("role"), "positive": u.get("positive_sample"), "stale": u.get("stale"), "excluded": u.get("excluded")} for u in upstream],
        })

    # --- scope rollup ---------------------------------------------------------
    all_hds = sorted({n for r in per_route for n in r["hdsComponentsUsed"]})
    all_unmapped = Counter()
    for route in routes:
        for value, n in route["styles"]["arbitraryColors"]:
            if not token_hex.get(norm_hex(value)):
                all_unmapped[value] += n
    non_hds = [c for c in components if c["layer"] in ("widget", "component", "feature")]
    page_local = [c for c in components if c["layer"] in ("page-module", "local")]
    roles_seen = Counter(p["role"] for r in per_route for p in r["platty"] if p.get("role"))

    summary = {
        "scope": facts["meta"]["scope"],
        "commit": facts["meta"]["commit"],
        "pack": pack["version"],
        "routes": len(routes),
        "plattySpecCoverage": {
            "routesWithSpec": sum(1 for r in per_route if r["platty"]),
            "routesWithoutSpec": sorted(r["routePath"] for r in per_route if not r["platty"]),
            "routesInUpstreamScreenInventory": sum(1 for r in per_route if r["inUpstreamScreenInventory"]),
            "routesAsPositiveSample": sorted(r["routePath"] for r in per_route if any(u["positive"] for u in r["inUpstreamScreenInventory"])),
        },
        "components": {
            "distinctUsed": len(components),
            "hdsDistinct": len(all_hds),
            "hdsUsed": all_hds,
            "hdsDrawableByPack": sorted({n for r in per_route for n in r["hdsDrawableByPack"]}),
            "hdsNotInPack": sorted({n for r in per_route for n in r["hdsNotInPack"]}),
            "packPromoted": sorted(promoted),
            "sharedNonHdsDistinct": len(non_hds),
            "sharedNonHdsTop": [{"name": c["name"], "module": c["module"], "routes": c["routeCount"]} for c in non_hds[:25]],
            "pageLocalDistinct": len(page_local),
        },
        "tokens": {
            "packTokenColors": len(token_hex),
            "tailwindThemeColors": len(theme["colors"]),
            "themeColorsMatchingPackToken": sum(1 for h in theme_hex if h in token_hex),
            "arbitraryColorOccurrences": sum(all_unmapped.values()) + sum(n for r in routes for h, n in r["styles"]["arbitraryColors"] if token_hex.get(norm_hex(h))),
            "distinctArbitraryColors": len({h for r in routes for h, _ in r["styles"]["arbitraryColors"]}),
            "distinctArbitraryUnmapped": len(all_unmapped),
            "topUnmappedColors": all_unmapped.most_common(25),
        },
        "roles": {
            "packRoles": sorted(pack_roles),
            "rolesAssignedInScope": roles_seen.most_common(),
            "packReferenceImagesByRole": pack_reference_roles.most_common(),
        },
        "states": {
            "routesWithEmptyState": sum(1 for r in per_route if r["states"]["empty"]),
            "routesWithErrorState": sum(1 for r in per_route if r["states"]["error"]),
            "routesWithLoadingState": sum(1 for r in per_route if r["states"]["loading"]),
            "routesWithOverlay": sum(1 for r in per_route if r["states"]["overlay"]),
            "totalConditionalRenders": sum(r["conditionalRenders"] for r in per_route),
        },
        "api": {
            "distinctEndpoints": len({p for r in per_route for p in r["apiPaths"]}),
            "routesWithNoDetectedApi": sorted(r["routePath"] for r in per_route if not r["apiPaths"]),
        },
        "copy": {"totalOwnedStrings": sum(r["copyStrings"] for r in per_route)},
    }

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "coverage.json").write_text(json.dumps({"summary": summary, "routes": per_route}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Truncated JSON is not JSON; print what a caller can read and parse the file for detail.
    print(json.dumps({
        "out": str(out / "coverage.json"),
        "routes": summary["routes"],
        "hdsUsed": len(summary["components"]["hdsUsed"]),
        "hdsDrawableByPack": len(summary["components"]["hdsDrawableByPack"]),
        "referencesByRole": len(summary["roles"]["packReferenceImagesByRole"]),
        "distinctArbitraryColors": summary["tokens"]["distinctArbitraryColors"],
        "unmappedColors": summary["tokens"]["distinctArbitraryUnmapped"],
    }, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
