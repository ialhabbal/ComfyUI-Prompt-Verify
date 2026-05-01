# ComfyUI — Prompt Verify

**Prompt Verify** is a ComfyUI custom node that pauses your workflow and lets you review, edit, and approve the prompt text before image generation begins — all inside the node itself, no popups or floating windows.

Whether you're working with wildcards, an LLM assistant, or just want a quick sanity-check before a long render, Prompt Verify gives you a human-in-the-loop checkpoint that fits right into your existing workflow.

---

## Installation

1. Open your ComfyUI `custom_nodes` folder.
2. Open a terminal there and run:
   ```
   git clone https://github.com/ialhabbal/ComfyUI-Prompt-Verify.git
   ```
3. Restart ComfyUI.
4. Search for **Prompt Verify** in the node browser to add it.

---

## What It Does

When your workflow reaches the Prompt Verify node, execution **pauses**. The node's built-in text editor fills with the current prompt and a **▶ Submit** button becomes active. You can read the prompt, change whatever you like, then click Submit (or press `Shift+Enter`) to let the workflow continue. If you walk away, the node will auto-submit after the timeout you set.

The node outputs two things:
- **CONDITIONING** — a ready-to-use CLIP-encoded conditioning signal (only when a CLIP model is connected).
- **STRING** — the final confirmed text, which you can pipe anywhere else in your workflow.

---

## The Node's Interface

Inside the node you'll find, from top to bottom:

**1. The editor textarea** — where your prompt text appears. Click into it and edit freely.

**2. The Submit row** — contains the `▶ Submit` button and a status indicator.

| Status message | What it means |
|---|---|
| `Idle` | Node is not currently active. |
| `⏳ Waiting for input…` | Workflow is paused. Edit and submit. |
| `✔ Submitted` | Your text was sent and the workflow is resuming. |
| `✔ Auto-submitted` | Editor had text and both toggles were off — submitted without waiting. |
| `⏱ Timed out — auto-submitted` | Timeout elapsed; current editor text was submitted automatically. |

**3. The prompt library panel** — search, load, save, delete, rename, export, and import your saved prompts.

---

## Input Modes

The node has two toggle switches that control where the text in the editor comes from. Understanding them is the key to getting the most out of the node.

### Mode 1 — Editor Only (both toggles off)

The simplest setup. Whatever is already typed into the editor widget is used directly.

**How it behaves:** If the editor contains text when the workflow runs, it is submitted automatically without pausing — you get the speed of a normal CLIP Text Encode node, but you can intervene by editing the text before you queue. If the editor is empty, the node pauses and waits for you to type something.

**Best for:** Fixed starting prompts you occasionally want to tweak, or any situation where you want zero interruption by default but the option to override.

---

### Mode 2 — External Text Input (`use_external_text_input` = on)

Connect any STRING output from another node (a text node, wildcard sampler, prompt builder, etc.) to the `text` input. When the workflow runs, that text is loaded into the editor and the node **pauses** so you can review it before submitting.

The `text` connection is **lazy** — it is only evaluated when this toggle is on, so turning it off costs you nothing in a complex graph.

**Best for:** Wildcard or random prompt workflows where you want to see what was generated before committing to a render.

---

### Mode 3 — LLM Input (`use_llm_input` = on)

Connect the text output of an LLM node to the `llm_input` input. The LLM's output is loaded into the editor and the node **pauses** for your review.

If both `use_external_text_input` and `use_llm_input` are on at the same time, the **LLM input always wins**. Turn off `use_llm_input` to fall back to the external text connector.

Like the `text` input, `llm_input` is **lazy** — it won't be evaluated unless the toggle is on.

**Best for:** AI-assisted prompting where an LLM expands a short idea into a detailed description, and you want final say before it goes to the image generator.

---

## Timeout

The `timeout` setting (default: 60 seconds, max: 2400 seconds) controls how long the node waits before giving up.

- **You submit in time:** workflow continues immediately with your edited text.
- **Timeout expires:** whatever is currently in the editor is submitted automatically. A 5-second grace window is given after the timeout fires, so a last-second edit or click still makes it through.

Set a long timeout (e.g. 300 seconds) when you're working interactively. Set a short one (e.g. 15 seconds) when you want a brief review window in a semi-automated pipeline.

---

## CLIP Encoding

Connect a **CLIP** model to the optional `clip` input and the node will encode the final text into a **CONDITIONING** output — exactly like a standard CLIP Text Encode node. You can use Prompt Verify as a direct drop-in replacement.

If no CLIP is connected, the CONDITIONING output is `None` and only the STRING output carries data.

---

## The Prompt Library

The node has a built-in library for saving and reusing prompts. Everything is stored in a JSON file inside your ComfyUI user directory (`prompt_verify_data.json`) and persists across sessions.

### Saving a prompt
1. Type or edit your prompt in the editor.
2. In the Save row, fill in a **Category** (e.g. `Portraits`) and a **Prompt name** (e.g. `cinematic golden hour`). The Category field auto-suggests your existing categories as you type.
3. Click **Save**.

If a prompt with the same name already exists in that category, it is updated in place — any metadata (LoRA associations, trigger words, thumbnails) that other tools stored alongside it is preserved.

### Loading a prompt
1. In the Load row, pick a **Category** from the first dropdown.
2. Pick a **Prompt name** from the second dropdown. A **preview** of the prompt text appears below the dropdowns so you can confirm it's the right one before loading.
3. Click **Load**. The text drops into the editor immediately.

### Searching across your library
Type into the **🔍 Filter prompts…** search box above the Load row. The name dropdown updates live to show only prompts whose names contain your search text. This works within the selected category.

### Deleting a prompt
Select the category and prompt name in the Load row, then click **🗑 Delete selected**. You'll be asked to confirm before anything is removed. If that was the last prompt in a category, the category is removed too.

### Renaming a category
Select the category you want to rename in the Load row, type the new name into the **Rename category to…** field, and click **Rename cat.** All prompts in that category move over to the new name. The rename is case-insensitive-collision-safe — if a category with that name already exists, you'll get an error rather than a silent merge.

### Exporting your library
Click **⬇ Export** to download your entire prompt library as a single `prompt_verify_data.json` file. Use this to back up your prompts or transfer them to another machine.

### Importing a library
Click **⬆ Import** and pick a previously exported JSON file. The import **merges** with your existing library — prompts with the same category and name are updated, everything else is left untouched. After a successful import the status line tells you how many prompts were added and how many were updated.

---

## Practical Workflows

### Quick review before a long render
Leave both toggles off. Type a solid base prompt into the editor. Each time you queue the workflow, the node auto-submits immediately — but if you want to change something before a particular run, just edit the editor text beforehand. Zero interruption when you don't need it, easy override when you do.

### Approving wildcard-generated prompts
Connect a wildcard sampler to `text` and turn on `use_external_text_input`. Each run, the randomly expanded prompt appears in the editor. Read it, trim anything that looks off, then hit Submit. You get the variety of randomness with the safety net of a human check.

### LLM-assisted prompting with a final edit
Connect an LLM node to `llm_input` and turn on `use_llm_input`. Write a short concept (e.g. "elderly fisherman at sunrise") into the LLM, let it produce a rich detailed prompt, and Prompt Verify will catch it for your review before it hits the image model. Shorten, rephrase, or approve as-is.

### Fully automated pipeline with a safety window
Set `timeout` to 10–20 seconds and leave both toggles off with your preferred prompt already in the editor. The node fires each run and auto-submits after the timeout if you ignore it. You only need to act when something looks wrong — otherwise the pipeline runs unattended.

### Building a reusable prompt kit
Over time, use Save to build up a library of your best prompts organised by category (e.g. `Lighting`, `Styles`, `Characters`, `Environments`). Before a session, use the Load row to pull in the right starting point, then tweak from there. Export the library periodically as a backup.

---

## Screenshots

### The Node
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/the_node.png)

### Simple Workflow
![ComfyUI-Prompt-Verify simple workflow](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/simple_workflow.png)

### The Node in Action
![ComfyUI-Prompt-Verify in action](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/workflow.png)

---

MIT License 

---

Developed by [ialhabbal](https://github.com/ialhabbal)

---
