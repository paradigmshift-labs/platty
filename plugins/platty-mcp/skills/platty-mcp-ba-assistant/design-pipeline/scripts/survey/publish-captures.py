#!/usr/bin/env python3
"""Design pack survey — publish runtime captures into the upstream pipeline as reference evidence.

Copies the captures the survey produced into the upstream source tree and writes
inventory/runtime-captures.json, which the pack builder reads. Screens that did not
render keep a row with included=false so the gap stays visible instead of disappearing.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slug(route):
    return route.strip("/").replace("/", "-").replace(":", "") or "root"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--survey", required=True)
    ap.add_argument("--upstream", required=True)
    ap.add_argument("--out-name", default="inventory/runtime-captures.json")
    args = ap.parse_args()

    survey = Path(args.survey)
    upstream = Path(args.upstream)
    captures = json.loads((survey / "captures" / "capture-manifest.json").read_text(encoding="utf-8"))
    coverage = json.loads((survey / "coverage.json").read_text(encoding="utf-8"))
    role_by_route = {
        r["routePath"]: (r["platty"][0]["role"] if r["platty"] else None)
        for r in coverage["routes"]
    }

    rows = []
    copied = 0
    for result in captures["results"]:
        route = result["routePath"]
        role = role_by_route.get(route)
        verdict = result["renderVerdict"]
        include = verdict in ("rendered", "error-state") and bool(result.get("screenshot")) and bool(role)
        local = f"references/runtime/{slug(route)}/screenshot.png"
        row = {
            "id": f"runtime:{slug(route)}",
            "route": route,
            "role": role,
            "state": "error" if verdict == "error-state" else "default",
            "verdict": verdict,
            "included": include,
            "screenshot": local if include else None,
            "textSample": (result.get("textSample") or "")[:120],
        }
        if include:
            source = survey / "captures" / result["screenshot"]
            target = upstream / local
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            row["sha256"] = sha256(target)
            copied += 1
        else:
            row["excludedReason"] = (
                "화면이 렌더되지 않았다 (로그인 세션 또는 실제 데이터 필요)" if verdict in ("blank", "navigation-failed")
                else "역할 매핑이 없다" if not role else f"채택 조건 미달: {verdict}"
            )
        rows.append(row)

    document = {
        "schema": "runtime-captures.v1",
        "repo": "heroines-webview",
        "source_revision": captures["commit"],
        "scope": captures["scope"],
        "capture": {
            "viewport": captures["viewport"],
            "mode": captures["mode"],
            "capturedAt": captures["capturedAt"],
        },
        "authority": (
            "Observation of the running application at this commit. It shows what the code produced "
            "under mock/unauthenticated conditions; it is not a designer-approved design and not a "
            "production deployment observation."
        ),
        "limitation": (
            "Dynamic routes use placeholder ids and there is no signed-in session, so many screens "
            "show empty, error or not-found states rather than a populated default state. Captures "
            "carry live product and campaign content and are internal material."
        ),
        "counts": {
            "total": len(rows),
            "included": sum(1 for r in rows if r["included"]),
            "excluded": sum(1 for r in rows if not r["included"]),
        },
        "rows": rows,
    }
    out = upstream / args.out_name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"wrote": str(out), "copiedImages": copied, "counts": document["counts"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
