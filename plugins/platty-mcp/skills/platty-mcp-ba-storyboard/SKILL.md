---
name: storyboard
description: Draw an Airbnb "Snow White" style journey storyboard — stages left to right, layers (사람·기분·제품·정책·서비스·측정) top to bottom — from a confirmed JTBD, PRD, and user experience, so designers and developers understand why the work exists and what the user should feel. Use after the user_experience stage is confirmed, or when the planner asks for a storyboard of a BA case.
---

# BA Storyboard

Run when the BA case has a confirmed `jtbd.json`, `prd.json`, and `user-experience.json`
(`session.py status` shows `start_screen_behavior` or later), or when the planner asks for a
storyboard of such a case. The audience is the designer and the developer who were not in the
interview; the page must let them feel the user's day, not re-read the PRD.

**This stage asks the planner nothing new.** Every frame is derived from the confirmed files.
If a frame needs a judgment the upstream never made, leave it out and say so in the reply.

## Method (Snow White)

1. **List the emotional moments first.** Walk the user-experience scenarios in time order and
   pick 5–8 moments where the person's feeling changes. These become the stage columns.
2. **Make the person concrete.** The persona card uses the JTBD 주체·상황·동기·기대·성공 판정
   verbatim or near-verbatim. A given name is allowed only when labelled as a drawing aid
   (e.g. 「그림용으로 붙인 이름」).
3. **Mark the moment of truth.** The stage where the arms or outcomes diverge gets
   `scene.moment: "진실의 순간"`.
4. **Start where they first hear of it, end where they tell someone else.** First stage =
   the ad or trigger (may be `off: true` when out of scope); last stage = the return visit and
   passing it on.
5. **Most of the experience happens offline.** Say so on the stage where the person is away
   from the app.

## Where each layer comes from

| Layer | Source | Rule |
| --- | --- | --- |
| 사람 · 속마음 | JTBD cells (`뭐가 안 되나`), PRD pain points, UX state `user_meaning` | Quote-like first person. Split by arm (`ctl`/`exp`) only where the arms differ. |
| 기분 | JTBD emotion rows | Always captioned 가설 unless the JTBD row is 관찰. Values 1–5 per stage. |
| 제품 | PRD rules' acceptance text, UX `information_shown`, current copy from Platty code | Use the real strings. Mark invented copy `문안 예시`. |
| 정책 | PRD `R-*` / `D-*` ids with one-line meaning | Every rule the stage exercises. |
| 서비스 | PRD rules' system side, UX `system_response`, UX handoff issues | What the system does behind the screen. |
| 측정 | PRD success hypotheses, decisions on metrics, guardrails | Which number this stage moves. `kind: key` for the target, `alarm` for a fail line. |

Close with three `notes` cards: 디자인 (what to draw), 개발 (what not to miss), 함께 볼 것
(what the board assumes). Put the confirmed document links in `docs` (Notion pages when the
notion-publish skill has run, repository paths otherwise).

## Steps

1. Write `storyboard.spec.json` next to the case (shape: `examples/sample.spec.json`, a
   fictional case). Fill `art.style`, `art.character`, and one `scene.prompt` per stage — the
   prompt describes the scene and emotion only; the character sentence keeps faces consistent.
2. **Scene images, in this order:**
   1. `python3 scripts/gen_scenes.py <spec> --out <dir>` — Gemini on Vertex AI with the user's
      Application Default Credentials (ADC). It reads `PLATTY_BA_VERTEX_PROJECT` (required),
      `PLATTY_BA_VERTEX_LOCATION` (default `global`) and `PLATTY_BA_IMAGE_MODEL` from the
      environment, then from the local settings file `~/.config/platty-mcp/ba.env`
      (`PLATTY_BA_ENV_FILE` overrides the path). It never stores or prints a token.
   2. If it prints `skipped`, use an image tool this session already has, if any: generate each
      prompt and save to `img/scene-<n>.jpg`.
   3. Otherwise build without images. The builder draws a labelled placeholder for every missing
      image. Tell the planner why (the `skipped` reason) and that
      `gcloud auth application-default login` plus the settings file enable images.
   A stage that returns `error` with HTTP 403 means the account lacks Vertex AI access on that
   project; report it to the planner instead of retrying.
   Generated images often contain stray captions ("FRAME 2 OF 7") or clocks. Look at each one
   and regenerate (`--only <n> --force`) or crop before building.
3. `python3 scripts/build_storyboard.py <spec> --out <dir> --standalone` writes
   `storyboard.html` (images as files, for publishing) and `<slug>.html` (one file with images
   embedded, for sending).
4. Publish or send the result the way the host allows (an Artifact with `img/*` as files, or
   the standalone file). Tell the planner which frames are hypotheses and which copy is invented.

## Guardrails

- Never put an API key, access token, project-specific setting, or settings-file content in the
  spec, the page, or a file in the plugin.
- Hypothesis rows stay labelled as hypotheses on the page.
- The board may simplify; it may not contradict a confirmed rule or decision.
