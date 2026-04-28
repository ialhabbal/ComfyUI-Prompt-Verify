## How to Use Prompt Verify

**Prompt Verify** is a ComfyUI custom node that pauses your workflow mid-run and presents you with a floating editor panel, letting you review, edit, and confirm the prompt text before generation continues. It's built for anyone who wants a human-in-the-loop checkpoint in their image generation pipeline.

---

### What It Does

When your workflow reaches the Prompt Verify node, execution pauses and a floating popup editor appears on your screen. You can review the current prompt text, make any last-minute changes, then click **Submit** to continue the workflow — or let the timeout expire to pass the text through automatically.

The node outputs two things: a **CONDITIONING** signal (if a CLIP model is connected) and a **STRING** of the final confirmed text, so it can slot directly into your existing CLIP text encode setup or be used as a plain text output.

---

### Input Modes

The node supports three different sources for the text that appears in the editor panel. These are controlled by two toggle switches on the node.

- **Editor only (both toggles off):** The simplest mode. Whatever you type directly into the node's built-in `editor` widget is what appears in the popup. No external connections needed. Use this when you want a fixed starting point to edit from each run.

- **External text input (`use_external_text_input` = on):** Connect any `STRING` output from another node (e.g. a text node, a prompt builder, or a wildcard sampler) into the `text` connector. That text becomes the pre-filled content of the popup editor, which you can then tweak before submitting. The `text` input is *lazy* — it won't be evaluated unless this toggle is on, which keeps your workflow efficient.

- **LLM input (`use_llm_input` = on):** Connect the text output of an LLM node into the `llm_input` connector. When this toggle is on, the LLM's output overrides the `text` input and appears in the editor panel for you to review. Like the `text` connector, `llm_input` is lazy and only evaluated when the toggle is enabled. If both `use_external_text_input` and `use_llm_input` are on, the LLM input takes priority.

> **Toggle interaction rule:** If `use_llm_input` is on, it always wins over `use_external_text_input`. Turn off `use_llm_input` if you want the external text connector to be used instead.

---

### The Floating Editor Panel

When the node fires during a run, a dark floating panel appears on your screen with:

- A **textarea** pre-filled with the current prompt text — edit it freely.
- A **Submit** button (or press `Shift + Enter`) to confirm your edits and resume the workflow.
- A **Close** button to dismiss the panel without submitting (the node will then wait until the timeout elapses).
- A **drag handle** (top-right `≡` icon) to reposition the panel anywhere on screen. Its position is saved per-node, so it'll remember where you left it next time.
- A **resize grip** (bottom-right `◢`) to make the panel larger or smaller. This is also saved between sessions.

The panel automatically opens near its node in the graph. If you've previously moved it, it restores to your last position.

---

### Saving and Loading Prompts

The panel includes a built-in prompt library system, so you can reuse your best prompts without copying and pasting.

**To save a prompt:**
1. Type or edit your prompt in the textarea.
2. At the bottom of the panel, enter a **Category** (e.g. `Portraits`, `Landscapes`, `Fantasy`) and a **Prompt name** (e.g. `cinematic lighting base`).
3. Click **Save Prompt**. The prompt is saved to a JSON file in your ComfyUI user directory (`prompt_verify_data.json`).

**To load a saved prompt:**
1. At the top of the panel, use the two dropdowns to select a **Category** and then a **Prompt name**.
2. Click **Load**. The saved text is immediately written into the textarea, ready to submit or further edit.

Saved prompts are sorted alphabetically by category and name. If you save a prompt with the same name (case-insensitive) as an existing one, it will be updated in place, preserving any metadata like associated LoRAs or trigger words that other tools may have stored alongside it.

---

### Timeout Behavior

The `timeout` parameter (default: 60 seconds, max: 2400 seconds) controls how long the node waits for you to submit before automatically continuing.

- If you **submit** before the timeout: the workflow continues immediately with your edited text.
- If the **timeout expires**: the panel auto-submits whatever is currently in the textarea (even if you haven't clicked Submit), and the workflow continues. A 5-second grace period is given after the timeout fires before the value is forcibly passed through.

This means you can set a generous timeout for manual workflows, or a shorter one for semi-automated pipelines where you just want a brief review window.

---

### Panel Size Defaults

The node exposes several optional parameters to control the default size and position of the popup panel. These are useful if you have a particular screen layout or run ComfyUI at an unusual resolution.

| Parameter | Default | Description |
|---|---|---|
| `panel_default_width` | 520 | Starting width of the panel in pixels |
| `panel_default_height` | 160 | Starting height of the panel in pixels |
| `panel_min_width` | 320 | Minimum width when resizing |
| `panel_min_height` | 120 | Minimum height when resizing |
| `panel_pad_y` | 80 | Vertical space reserved for the panel's buttons |

These only set the initial defaults — once you manually resize the panel, your custom size is saved and used going forward.

---

### CLIP Encoding

Connect a **CLIP** model to the optional `clip` input and the node will encode the final confirmed text into a **CONDITIONING** output, exactly like a standard CLIP Text Encode node. If no CLIP is connected, the CONDITIONING output will be `None` and only the STRING output will carry useful data.

This lets you use Prompt Verify as a direct drop-in replacement for a CLIP Text Encode node in your workflow.

---

### Example Setups

**Basic manual prompt review:**
Connect nothing to the text inputs. Type a draft prompt into the `editor` widget. Each run, the popup appears with your draft pre-filled — edit it, submit, generation starts.

**Wildcard / dynamic prompt review:**
Connect a wildcard sampler or random prompt node to `text` and turn on `use_external_text_input`. Each run, the randomly generated prompt appears in the popup so you can approve or tweak it before it's used.

**LLM-assisted prompting:**
Connect an LLM node (e.g. one that expands a short idea into a detailed image description) to `llm_input` and turn on `use_llm_input`. The LLM's output appears in the editor — you get the benefit of AI-generated detail while keeping final say over what gets submitted.

**Fully automated with a safety window:**
Set a short timeout (e.g. 15 seconds) and leave your preferred prompt in the `editor` widget. The popup will appear briefly each run, but if you don't intervene, it auto-submits and generation continues uninterrupted. You only need to act when something looks wrong.

### The Node
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/the_node.png)

### The Node in Action
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/workflow.png)

## How to install
1. Open ComfyUI Custom Nodes folder
2. Open a terminal window (cmd)
3. Type this: https://github.com/ialhabbal/ComfyUI-Prompt-Verify.git
4. Restart ComfyUI
5. Search for the node: Prompt Verify

## Update 1.1.0

- Added Clip Text Encode functionality.

MIT License

Developed by: ialhabbal
