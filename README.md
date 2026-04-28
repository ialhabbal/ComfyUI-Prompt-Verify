## How to Use Prompt Verify

**Prompt Verify** is a ComfyUI custom node that pauses your workflow mid-run and lets you review, edit, and confirm the prompt text before generation continues — entirely within the node itself, no floating windows. It's built for anyone who wants a human-in-the-loop checkpoint in their image generation pipeline.

---

### What It Does

When your workflow reaches the Prompt Verify node, execution pauses and the node's built-in editor is populated with the current prompt text. A **Submit** button activates inside the node, and a status indicator shows that the node is waiting for your input. You can edit the text freely, then click **Submit** (or press `Shift+Enter`) to continue the workflow — or simply wait for the timeout to auto-submit and move on.

The node outputs two things: a **CONDITIONING** signal (if a CLIP model is connected) and a **STRING** of the final confirmed text, so it can slot directly into your existing CLIP text encode setup or be used as a plain text output.

---

### Input Modes

The node supports three different sources for the text that appears in the editor. These are controlled by two toggle switches on the node.

- **Editor only (both toggles off):** The simplest mode. Whatever you type directly into the node's built-in `editor` widget is what gets used. No external connections needed. Use this when you want a fixed starting point to edit from each run.

- **External text input (`use_external_text_input` = on):** Connect any `STRING` output from another node (e.g. a text node, a prompt builder, or a wildcard sampler) into the `text` connector. When the workflow runs, that text is loaded into the editor so you can review and tweak it before submitting. The `text` input is *lazy* — it won't be evaluated unless this toggle is on, keeping your workflow efficient.

- **LLM input (`use_llm_input` = on):** Connect the text output of an LLM node into the `llm_input` connector. When this toggle is on, the LLM's output overrides the `text` input and is loaded into the editor for you to review. Like the `text` connector, `llm_input` is lazy and only evaluated when the toggle is enabled. If both `use_external_text_input` and `use_llm_input` are on, the LLM input takes priority.

> **Toggle interaction rule:** If `use_llm_input` is on, it always wins over `use_external_text_input`. Turn off `use_llm_input` if you want the external text connector to be used instead.

---

### The In-Node Editor

When the node fires during a run, the editor widget inside the node is filled with the incoming text and the **Submit** button becomes active. Everything happens directly on the node — no popups, no floating windows.

- **Edit** the text freely in the editor textarea.
- **Submit** by clicking the green `▶ Submit` button or pressing `Shift+Enter`.
- The **status indicator** next to the button shows the current state at a glance:
  - `Idle` — node is not currently waiting for input.
  - `⏳ Waiting for input…` — node is paused and ready for your edits.
  - `✔ Submitted` — text was submitted and the workflow is continuing.
  - `⏱ Timed out — auto-submitted` — the timeout elapsed and the current editor text was submitted automatically.

The Submit button is disabled and grayed out when the node is not actively waiting, so it cannot be accidentally clicked between runs.

---

### Saving and Loading Prompts

The node includes a built-in prompt library, so you can save and reuse your best prompts without copying and pasting.

**To save a prompt:**
1. Type or edit your prompt in the editor textarea.
2. In the Save row below the editor, enter a **Category** (e.g. `Portraits`, `Landscapes`, `Fantasy`) and a **Prompt name** (e.g. `cinematic lighting base`).
3. Click **Save**. The prompt is saved to a JSON file in your ComfyUI user directory (`prompt_verify_data.json`).

**To load a saved prompt:**
1. In the Load row, use the two dropdowns to select a **Category** and then a **Prompt name**.
2. Click **Load**. The saved text is immediately written into the editor, ready to submit or further edit.

Saved prompts are sorted alphabetically by category and name. If you save a prompt with the same name (case-insensitive) as an existing one, it will be updated in place, preserving any metadata like associated LoRAs or trigger words that other tools may have stored alongside it.

---

### Timeout Behavior

The `timeout` parameter (default: 60 seconds, max: 2400 seconds) controls how long the node waits for you to submit before automatically continuing.

- If you **submit** before the timeout: the workflow continues immediately with your edited text.
- If the **timeout expires**: whatever is currently in the editor is submitted automatically, the status indicator updates to `⏱ Timed out — auto-submitted`, and the workflow continues. A 5-second grace period is given after the timeout fires before the value is forcibly passed through.

This means you can set a generous timeout for manual workflows, or a shorter one for semi-automated pipelines where you just want a brief review window.

---

### CLIP Encoding

Connect a **CLIP** model to the optional `clip` input and the node will encode the final confirmed text into a **CONDITIONING** output, exactly like a standard CLIP Text Encode node. If no CLIP is connected, the CONDITIONING output will be `None` and only the STRING output will carry useful data.

This lets you use Prompt Verify as a direct drop-in replacement for a CLIP Text Encode node in your workflow.

---

### Example Setups

**Basic manual prompt review:**
Connect nothing to the text inputs. Type a draft prompt into the `editor` widget. Each run, the editor is pre-filled with your draft and the Submit button activates — edit it, submit, generation starts.

**Wildcard / dynamic prompt review:**
Connect a wildcard sampler or random prompt node to `text` and turn on `use_external_text_input`. Each run, the randomly generated prompt is loaded into the editor so you can approve or tweak it before it's used.

**LLM-assisted prompting:**
Connect an LLM node (e.g. one that expands a short idea into a detailed image description) to `llm_input` and turn on `use_llm_input`. The LLM's output appears in the editor — you get the benefit of AI-generated detail while keeping final say over what gets submitted.

**Fully automated with a safety window:**
Set a short timeout (e.g. 15 seconds) and leave your preferred prompt in the `editor` widget. The Submit button will activate briefly each run, but if you don't intervene, it auto-submits and generation continues uninterrupted. You only need to act when something looks wrong.

### The Node
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/the_node.png)

### Simple Worklflow
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/simple_workflow.png)

### The Node in Action
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/workflow.png)

## How to install
1. Open ComfyUI Custom Nodes folder
2. Open a terminal window (cmd)
3. Type this: https://github.com/ialhabbal/ComfyUI-Prompt-Verify.git
4. Restart ComfyUI
5. Search for the node: Prompt Verify

## Update 1.1.0

- Debrecated the Floating Window.
- Added Clip Text Encode functionality.

MIT License

Developed by: ialhabbal
