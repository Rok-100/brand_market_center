# KOC LibTV Video Replication I/O Contract

## Contents

- Current task order and inputs
- Character-scene generation and canonical asset root
- Output bundle and prompt structure
- Deep-dive, duration, and per-clip prompt requirements
- Asset audits and final local recheck
- Continuity and exact-script checks
- LibTV/Seedance login, JSON-verified concurrent generation, download, and reporting

## Current Task Order Contract

For KOC remake tasks, follow this order:

1. Obtain or designate `<task_asset_root>` before creating any local task file. Product and character assets may arrive later, but the root folder may not be deferred.
2. Create an original-reference deep-dive Markdown file under `<task_asset_root>/analysis/deep_dive/` before prompt writing. Also present the key deep-dive findings in the user conversation. A chat-only summary, duration note, or product-exposure count is not sufficient.
3. Do not pre-copy, lock, or silently reuse product images or character-scene images from older projects before the current task's selected character scene and assets are confirmed.
4. If the user asks to place reference audio into the local asset folder first, copy only the processed reference audio there and record its path/hash.
5. After the user provides the selected character-scene image and product assets, build the prompt package from the saved deep-dive, exact new voiceover, selected character scene, processed reference audio, and product assets in that folder.
6. Output the video prompt package and a prompt-ready asset audit together for user confirmation. The audit must cover the local asset folder, selected character scene, product assets, reference audio, per-clip required assets, and product exposure storyboard numbers.
7. After the user confirms the prompt package, run the final script-confirmed local asset recheck again before any LibTV upload or generation.

## Input Bundle

| Input | Required | Notes |
| --- | --- | --- |
| Source style reference | Yes for full replication | Douyin/short-video URL, local video, screenshots, or prior analysis. Omit only for an explicitly requested no-reference draft. |
| Chat format | Yes or inferable | `单人唠嗑` or `双人唠嗑`; if inferred, state the assumption before prompt writing. |
| Candidate-generation mode | Yes | Always generate exactly three candidates at `50%`/`60%`/`70%`. Candidate images are generated checkpoint outputs, not user-supplied inputs. |
| Selected character scene | Yes | Exactly one final baseline image selected by the user, downloaded/saved by the user into the local asset folder, then reported back to the current executing agent. All clips must use this for identity, framing, and scene. |
| Current-task local asset folder | Yes before creating any local task artifact | Canonical root for all task data and source of truth for the selected character scene, product assets, and synced reference audio. |
| Product assets | Yes when product appears | Front/top/package views; record which clips need them. |
| Exact voiceover script | Yes | Locked text. Preserve line breaks, role labels, punctuation, and deliberate spelling. |
| Product replacement brief | Yes | Product name, product behavior, price/CTA, appearance constraints. |
| Reference audio | Required for Seedance KOC remake when a source reference video is available, unless the user explicitly declines | Source should be the reference video itself. Extract pure audio and trim to `<=14.8s` as the Seedance tone, pause, and speaking-rhythm reference. For generation, keep reference audio `<=` the video's first storyboard/clip duration, preferably `0.2-0.5s` shorter; if using per-clip audio variants, keep each variant `<=` its target clip duration. List it in standard assets and sync a copy into both the selected character-scene folder and product asset folder for later local validation. |
| Model/tool requirements | Yes for generation | Example: LibTV + Seedance 2.0 VIP. |
| Continuity constraints | Yes | One-take feel, max cuts, fixed positions, skin/product interaction rules, and per-clip non-speaker interaction intensity. |

## Character Scene Candidate Generation

Generate exactly `3` character-scene candidate images at `50%`, `60%`, and `70%` similarity. Before generating, inspect the available skills. If `jenvideo` exists, read it and use the exact model `open/gpt-image-2`. If the skill/model is unavailable or fails, report the fallback reason and use the available image-generation skill/model. Record the actual skill and model in the character-scene checkpoint.

Save all three candidates under `<task_asset_root>/assets/character_scene/candidates/`. Label each output clearly with its similarity percentage outside the image frame. Do not add in-image text, captions, subtitles, product packs, logos, price tags, or stickers unless the user explicitly requests them.

## Canonical Task Asset Root

Treat the user-provided current-task local asset folder as `<task_asset_root>`. Store every reusable source file, standard asset, intermediate artifact, prompt, JSON file, LibTV log, downloaded clip, and final preview under this root:

```text
<task_asset_root>/
├── source/
├── assets/character_scene/candidates/
├── assets/character_scene/selected/
├── assets/product/
├── assets/reference_audio/
├── analysis/deep_dive/
├── analysis/frames/
├── prompts/
├── intermediate/
├── libtv/logs/
├── libtv/state/
├── outputs/clips/
└── outputs/final/
```

Do not write task artifacts to an external `prep/` or `outputs/` directory. Reusable scripts remain in the skill's own `scripts/` directory, but their generated data and logs must be written below `<task_asset_root>`.

## Output Bundle

| Output | Path Pattern | Notes |
| --- | --- | --- |
| Original-reference deep-dive document | `<task_asset_root>/analysis/deep_dive/<product>_原片深度拆解.md` | Required for both `单人唠嗑` and `双人唠嗑` before character-scene candidates, prompt writing, or generation. Must include camera/framing, action, expression, gestures, pauses, speaking rhythm, product exposure logic, transition logic, replicable points, and points not to copy mechanically. |
| Prompt document | `<task_asset_root>/prompts/<product> KOC<单人唠嗑|双人唠嗑>视频提示词.md` | Human review source of truth. Must reference the original-reference deep-dive document. |
| Clip plan JSON | `<task_asset_root>/prompts/<product>_clip_plan*.json` | Required for every prompt package; its `final_libtv_prompt` is the only machine-executable prompt source. |
| Generated character-scene candidates | `<task_asset_root>/assets/character_scene/candidates/` | Exactly `50%`/`60%`/`70%`; label similarity outside the image frame and record the actual generation skill/model. |
| Character scene checkpoint | Prompt doc or `<task_asset_root>/prompts/*人物场景图确认*.md` | Include all three candidate states, selected local path, hash if available, chat-format fit, actual generation skill/model, and user-confirmation status. |
| Asset manifest | Prompt doc or `<task_asset_root>/prompts/*资产包.md` | Include local paths, source paths, hashes, and usage. |
| Prompt-ready asset audit | Prompt doc or `<task_asset_root>/prompts/*资产审计*.md` | Include current asset folder, existence/hashes, asset roles, per-clip usage, audio properties, and product visibility storyboards. |
| Non-speaker interaction checkpoint | In prompt doc | For `双人唠嗑`, classify each interaction clip as `low_reaction`, `active_support`, or `co_action`; record mandatory action geometry, source key frames, prompt-conflict audit, and output status. |
| Product exposure checkpoint | In prompt doc | Reference exposure count, new-prompt exposure count, exact storyboard numbers, and user approval status. |
| Script-confirmed local asset recheck | In prompt doc or audit record | Record pass/blocker status after user prompt approval and before upload or generation. |
| Processed audio | `<task_asset_root>/assets/reference_audio/*13s*.mp3` or `*14s8*.mp3` | Seedance-safe reference audio extracted from the source reference video itself, pure audio, `<=14.8s`; generation-safe audio must also be `<=` the first storyboard/clip duration, preferably `0.2-0.5s` shorter. Also sync copies into the selected character-scene folder and product asset folder. |
| LibTV logs | `<task_asset_root>/libtv/logs/*.json` | Keep create/upload/query/run results for traceability. |
| LibTV prompt-consistency checkpoint | Prompt doc, JSON, and LibTV logs | Compare Markdown/JSON `final_libtv_prompt` with node `data.params.prompt` for every clip; record pass or correction status. |
| Parallel run summary | `<task_asset_root>/libtv/state/parallel_run_summary.json` | Record every clip's node, start/end time, exit code, stdout/stderr paths, and batch success status. |
| LibTV workspace/canvas record | Prompt doc or LibTV logs | Record workspace/canvas URL and all relevant node names. |
| Generated videos | `<task_asset_root>/outputs/clips/<clip_no>_<task>_<model>.mp4` | After `libtv account info` confirms `activeAccount.memberAccount.effective=true`, download every successful LibTV generation with `--without-ai-watermark --vip`; validate with `ffprobe` and record the actual watermark result. |
| Full preview video | `<task_asset_root>/outputs/final/<canvas_or_workspace_name>_全片拼接预览版.mp4` | Required after all storyboard clips are downloaded and validated. Build from clips sorted by storyboard number using `ffmpeg -y -f concat -safe 0 -i <concat_list> -c copy <preview>.mp4`; keep the UTF-8-no-BOM concat list under `<task_asset_root>/intermediate/`. Validate with `ffprobe`. |
| Validation and blocker summary | Final report | Include per-clip/full-preview `ffprobe` results and distinguish model availability, compliance, and media-duration failures. |

## Prompt Document Structure

Use this structure for KOC remake prompt documents:

1. Standard assets
2. Original-reference deep-dive summary and link
3. Character scene confirmation
4. Reference audio confirmation
5. New-video duration calculation
6. Prompt-ready asset audit for user confirmation
7. Script-confirmed local asset recheck status, marked pending until user confirms prompts
8. Overall continuity control
8.1. For `双人唠嗑`, non-speaker interaction plan: classify each interaction clip and define its timed `non_speaker_action_track`
9. Exact voiceover script
10. Global generation prompt
11. Per-clip prompts
12. Stitching and pre-generation checks

## Original-Reference Deep-Dive Requirements

This is a required local file and a required conversation checkpoint. Save it in the current task folder before prompt writing, and show the key findings to the user in the conversation. Do not substitute a chat-only summary, duration note, or product-exposure count for the Markdown file.

Before prompt writing, produce `<task_asset_root>/analysis/deep_dive/<product>_原片深度拆解.md` for both single-person and double-person KOC videos. It must include:

- camera/framing and phone/lens feel
- body posture, head/shoulder movement, and relaxed-state behavior
- eye gaze, facial expression changes, and micro-pauses
- hand gestures, idle hand positions, and product/face-touch timing
- speaking rhythm, emotion curve, and pause logic
- product exposure logic and whether exposure is deliberate display or casual in-frame presence
- transition logic across segments
- replicable points for the new video
- points that should not be copied mechanically

For `单人唠嗑`, focus on the speaker's real solo sharing behavior. For `双人唠嗑`, additionally capture causal interaction between speaker and listener.

## Duration Calculation

The new video's total duration must be calculated from the new voiceover's character data in proportion to the reference video. Record the calculation and assumptions in the prompt document and clip plan JSON.

- Do not blindly use a fixed total duration, fixed 7 clips, or fixed per-clip durations.
- If the original reference transcript is available, use the reference-script character count and reference duration as the ratio baseline.
- If the original reference transcript is unavailable, estimate reference speech density from the source-video deep dive, state the estimate, and then assign per-clip durations under the model limit.

## Per-Clip Prompt Fields

Each clip should include:

- `分镜序号`
- `分镜时长`
- `时长策略`: default target `12-14.5s`; avoid overly short clips unless the user/reference/script requires it.
- `分镜主要承接的任务`
- `是否出现产品`
- `需要上传资产`
- `镜头连续性`
- `总体连续性与资产一致性控制`
- `画面内容`
- `动作时间点（每段从0s开始）`
- `interaction_mode` and timed `non_speaker_action_track` for every `双人唠嗑` clip containing interaction
- `口播文案`
- `分镜提示词`
- `负面提示词`

Each clip must also include `final_libtv_prompt`: the exact complete prompt text that will be passed to LibTV `--prompt`.

Before generation, persist `final_libtv_prompt` in both the Markdown prompt package and structured JSON clip plan for every clip. It must merge all model-critical instructions, including global continuity, source-reference conclusions, exact voiceover, timed actions, product/hand/camera logic, negative prompt, first-frame/tail-frame rules, and concrete local asset roles.

Use `{{Node <nodeKey>}}` placeholders in machine-executable `final_libtv_prompt`. Do not use name-based `{{Node "display name"}}` placeholders because LibTV resolves them to nodeKey form and would make the strict stored-prompt comparison fail.

Do not create a materially different prompt only at command execution time. If uploaded node names, reference-audio labels, tail-frame assets, or clip durations change, update the Markdown and JSON `final_libtv_prompt` first.

Every per-clip prompt must treat the clip as one connected segment of a complete KOC chatting video, not a standalone short. The beginning and ending of each clip should preserve continuity through gaze, posture, hand position, product position, emotional beat, or sentence momentum so the final stitched video avoids hard cuts.

For each `双人唠嗑` interaction clip, classify the non-speaker beat as `low_reaction` (gaze, smile, nod, small posture shift), `active_support` (clear arm/hand movement, pointing, passing, touching, or large temporary frame occupancy), or `co_action` (synchronized or paired actions such as side-by-side arm comparison or joint product display). Do not assume the non-speaker is male or that every action must stay low amplitude.

For `low_reaction`, keep the response subtle and tied to a specific line or action. For `active_support` and `co_action`, remove conflicting blanket constraints such as `低幅度`, `不抢画面中心`, `不接触产品`, or `保持静止` unless the reference requires them. Persist who moves, which limb/body part, screen side, motion path, lens distance, overlap order, start/end time, hold duration, and simultaneous action by the other person. Mark source-defining `active_support` and `co_action` beats as mandatory and state that replacing them with a passive reaction is not allowed.

When mandatory interaction uses near-camera multi-hand overlap or synchronized limbs, use source video motion reference when supported; otherwise connect dense key-action frames plus a character-scene baseline containing the starting pose. If the generated result misses the same mandatory action in two action-prioritized targeted attempts, stop automatic retries and request human direction for manual specialized generation or human result selection.

When reference audio is used, every clip's required assets must include `reference_audio`, and the standard asset section must include:

- source reference video path/URL
- processed reference audio path
- generation-safe trim rule and first storyboard/clip duration, verifying reference audio is `<=` that duration and preferably `0.2-0.5s` shorter
- synced reference-audio copy in the selected character-scene folder
- synced reference-audio copy in the product asset folder
- duration, codec, sample rate, channels, and hash
- LibTV audio node name/key when available

## Prompt-Ready Asset Audit

When the user has selected a character-scene image and provided the current task local asset folder, output the video prompt package and an asset audit together for confirmation. The audit must include:

1. The current task local asset folder path.
2. Selected character-scene image path, existence, hash when available, and fit for the requested chat format.
3. Product image paths, existence, hash when available, and which clips use each product asset.
4. Reference audio path, existence, duration, codec, sample rate, channels, hash, and whether its duration is `<=` the first storyboard/clip duration, preferably `0.2-0.5s` shorter.
5. Per-clip required assets and whether the product appears.
6. For each two-person interaction clip, its `interaction_mode`, mandatory action geometry, and source key-action references.
7. Product exposure checkpoint: reference-video exposure count, new-prompt exposure count, and exact storyboard/clip numbers.
8. A clear status that this is the prompt-confirmation audit and that a final script-confirmed local asset recheck still runs after the user approves the prompts.

## Script-Confirmed Local Asset Recheck

After the prompt package and prompt-ready asset audit have been shown to the user and the user confirms the script or prompt package, perform a final check before any generation:

1. Confirm the selected character-scene image exists in the local standard folder and matches the recorded hash.
2. Confirm product assets exist in the local product folder and match recorded hashes.
3. Confirm reference audio exists in `<task_asset_root>/assets/reference_audio/` and synced copies exist in both the selected character-scene folder and product folder.
4. Confirm reference audio was extracted from the source reference video itself and trimmed to `<=14.8s`; confirm generation audio is `<=` the first storyboard/clip duration, preferably `0.2-0.5s` shorter.
5. Confirm per-clip required assets match product visibility and include `reference_audio`.
6. Confirm the active LibTV canvas is the intended current-task canvas, not a stale prior test canvas.
7. Confirm exact per-clip voiceover still matches the locked script.
8. Confirm every two-person interaction clip retains the deep-dive `interaction_mode`, mandatory action geometry, source key-action references, and contains no conflicting low-amplitude/non-center constraint.

Do not start LibTV/Seedance video generation until this recheck passes.

## Required Per-Clip Continuity Block

Embed a compact version of this in every `分镜提示词`:

Also include this tail-control sentence in every per-clip prompt:

```text
口播结束后仅保留0.2-0.3秒自然收口表情用于拼接；不要停顿空镜、不要人物定格、不做无效表情停留、不要补动作拖时长。
```

```text
总体连续性与资产一致性控制：本分镜必须作为一条完整 KOC 单人/双人唠嗑视频中的连续段落生成，不是独立短片；人物情绪、动作表达、口播节奏参考原片深度拆解和参考链接；按同一台手机同一位置连续自拍处理，尽量一镜到底，可见切镜总次数控制在用户要求范围内；保持同一人物、同一机位、同一背景、同一光线、同一衣服、同一人物站位；分镜开头承接上一段的眼神、姿势、手部位置、产品位置、情绪或话头，分镜结尾仅留0.2-0.3秒自然收口表情方便拼接，尽量避免硬切；不要停顿空镜、人物定格、无效表情停留或补动作拖时长；人物肤质、位置、衣着、互动方式和产品资产一致；口播像熟记台词后随口聊天，不要念稿。
```

For `双人唠嗑`, add the mode-appropriate interaction block to every interaction clip. Use the following only for `low_reaction`:

```text
interaction_mode=low_reaction。非主讲人低幅度反应轨道：作为主讲人叙事旁边的轻微因果反应，不另开话题；根据主讲人这一句的情绪，安排非主讲人微笑、轻点头、短暂看向主讲人或小幅调整姿势，动作轻、慢、自然。
```

For `active_support` or `co_action`, replace that block with the exact mandatory timed action geometry from the deep-dive. Do not append generic `低幅度`, `不抢画面中心`, `不接触产品`, or `保持静止` wording that conflicts with the reference action.

## Script Matching Check

After editing:

1. Extract every clip `口播文案`.
2. Join clips with `\n`.
3. Compare to the user-provided full script exactly.
4. Search for stale words, especially names or CTAs the user changed.

Example PowerShell pattern:

```powershell
$joined = ($json.clips | ForEach-Object { $_.voiceover }) -join "`n"
if ($joined -ne $expected) { throw "voiceover mismatch" }
rg -n "旧人名|旧产品|旧价格" "<task_asset_root>/prompts/<prompt>.md"
```

## LibTV/Seedance Generation Contract

Before any LibTV operation, run `libtv account info`. On 401, signed-out, or invalid-credential errors, run `libtv login web --open` and wait for it to complete. Do not manually extract callback URLs, control a browser, or require a particular browser. Only if this login attempt fails, times out, or cannot complete the callback, notify the user to manually disable the system proxy/VPN and retry. Never pre-emptively require proxy shutdown and never change proxy settings automatically. If the retry still fails, use the documented `libtv login phone` flow, then verify again with `libtv account info`.

For each storyboard clip:

1. Treat the clip-plan JSON `final_libtv_prompt` as the only machine-executable prompt source. The Markdown copy is for human review.
2. Run `scripts/invoke-libtv-clip-plan-parallel.ps1 -ClipPlanPath <absolute-json-path>` once for the full clip plan. Do not invoke single-clip `-Run` commands manually and do not directly issue a handwritten `libtv node create --prompt` command.
3. Phase 1 must create and verify nodes sequentially. For each clip, `scripts/invoke-libtv-clip-plan.ps1` reads `final_libtv_prompt` from JSON and places it into the LibTV argument array as one string, preserving quotes, newlines, Unicode, `$`, backticks, and other shell-sensitive characters.
4. After every node creation, query the node and compare `data.params.prompt` against the JSON value using ordinal comparison after normalizing CRLF/CR to LF. Any other difference must throw and block the entire batch before any generation starts.
5. Phase 2 starts one independent blocking `libtv node <nodeKey> --run` process per clip. Start all processes before waiting so the full set of storyboards generates concurrently.
6. Keep every process's stdout and stderr in separate files. Do not connect concurrent processes to one NDJSON pipe. Let each CLI process perform its own internal polling; the orchestrator only waits for process completion and never polls task IDs.
7. A failed clip does not cancel already running siblings. Wait for all started runs to reach terminal state, then write a batch summary and report successes and failures together. Do not automatically resubmit failed clips.
8. Save create/query/verification/run logs below `<task_asset_root>/libtv/logs/`. Persist per-node state and `<task_asset_root>/libtv/state/parallel_run_summary.json` below `<task_asset_root>/libtv/state/`.

The clip-plan JSON must use this execution shape for every item in `clips`:

```json
{
  "clip_no": "01",
  "voiceover": "锁定口播",
  "final_libtv_prompt": "传给 LibTV 的完整最终提示词",
  "libtv": {
    "node_name": "01_开场",
    "node_type": "video",
    "left_nodes": ["人物场景", "参考音频"],
    "settings": {
      "model": "Seedance 2.0 VIP",
      "modeType": "mixed2video",
      "ratio": "9:16",
      "resolution": "720p",
      "duration": 14,
      "enableSound": "on",
      "autoCompliance": 1
    }
  }
}
```

Minimum settings for Seedance 2.0 VIP mixed reference KOC clips:

```text
-s "model=Seedance 2.0 VIP"
-s "modeType=mixed2video"
-s "ratio=9:16"
-s "resolution=720p"
-s "duration=<4-15>"
-s "enableSound=on"
```

When audio reference is used:

- Keep total reference audio/video duration <=14.8s when preparing KOC reference audio from the source reference video.
- For generation, keep the reference audio `<=` the video's first storyboard/clip duration, preferably `0.2-0.5s` shorter. If using per-clip audio nodes, each connected audio node must be `<=` that clip's `duration` parameter; trim and reupload when needed.
- Prefer pure audio file, not MP4 with video track.
- Use `autoCompliance=1` when assets are properly recorded.
- If stalled near 99% with audio connected, first trim audio below the target clip duration and retry. If the shortened-audio retry still cannot output a successful video, report the blocker and hand off for manual handling instead of adding duplicate diagnostic runs.
- For generic compliance blocks that are not duration or 99% stalls, a no-audio diagnostic can still be used to isolate media issues.

Download every completed clip with the explicit no-AI-watermark preference:

```text
libtv download -n <node> -o <task_asset_root>/outputs/clips --without-ai-watermark --vip
```

Use `--without-ai-watermark --vip` together only after `libtv account info` confirms `activeAccount.memberAccount.effective=true`. The first flag requests the original no-AI-watermark link and the second explicitly enables the member download strategy. Record both flags and the actual watermark inspection result; if effective membership cannot be confirmed, report the eligibility blocker instead of falsely declaring `--vip` or claiming guaranteed removal.

## Reporting To User

Final reports should include:

- What was created or changed.
- Exact paths to prompt docs, JSON, processed audio, synced audio copies, and videos.
- Exact path to the full concat preview video when all clips were generated successfully.
- Model actually used.
- Whether generation succeeded, and if not, the precise failure class.
- Short next step.
