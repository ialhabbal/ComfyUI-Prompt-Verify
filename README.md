# Prompt Verify

Prompt Verify is an interactive ComfyUI node that pauses a string flow and lets you edit the text in the browser before it continues. It is useful for quick manual tweaks to prompts, captions, or any string data without interrupting the pipeline.

## Key features
- Pauses a string and opens an inline editor in the UI for live edits.
- Submit edits with Shift+Enter, or click the Submit button.
- Configurable timeout (default 60s, max 2400s). If the timeout elapses, the current text is sent automatically.
- **Save & Load prompts** directly inside the node — store frequently used prompts by category and name, and reload them instantly.
- **External text input toggle** — enable or disable the `text` connector on the fly without disconnecting wires.
- **LLM input toggle** — connect a language model output and use it as the source text with a single toggle.
- Works with the built-in front-end; client and server communicate via prompt_verify_request / prompt_verify_response.

### External text passthrough
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/external_text_passthrough.png)
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/external_text_passthrough_1.png)

### llm text passthrough
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/llm_text_passthrough.png)
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/llm_text_passthrough_1.png)

### In-node text passthrough
![ComfyUI-Prompt-Verify Node](https://raw.githubusercontent.com/ialhabbal/ComfyUI-Prompt-Verify/main/media/in_node_text_passthrough.png)

## How to install
1. Open ComfyUI Custom Nodes folder
2. Open a terminal window (cmd)
3. Type this: https://github.com/ialhabbal/ComfyUI-Prompt-Verify.git
4. Restart ComfyUI
5. Search for the node: Prompt Verify

## Update 1.1.0

- Added Clip Text Encode functionality.

## How to use

### Basic usage
1. Connect a STRING input to the node's `text` socket (e.g. a Florence2 Captioner).
2. (Optional) Provide initial text in the `editor` field to prefill the editor.
3. Set `timeout` to control how long the node waits for user edits (seconds).
4. When the node executes, the UI will show an editor. Make your changes and press Shift+Enter or click Submit.
5. If you don't submit before the timeout, the current text is used and the node continues.

### External text input toggle (`use_external_text_input`)
- When **off** (default): the `text` connector is ignored even if a node is wired to it. The editor opens empty (or prefilled from the `editor` field).
- When **on**: the value arriving on the `text` connector is passed into the editor as the starting text, just as before.
- This lets you temporarily bypass an upstream node without disconnecting any wires.

### LLM input toggle (`use_llm_input`)
- When **on**: the text arriving on the `llm_input` connector is used as the source text instead of `text`. This is evaluated lazily — the upstream LLM node only runs when the toggle is enabled.
- When **off** (default): the `llm_input` connector is ignored entirely and the normal `text` / `editor` flow applies.
- Both toggles can coexist. If both are on, `llm_input` takes priority over `text`.

### Save & Load prompts
The node has a built-in save/load panel at the top:
- **Load row**: select a category and prompt name from the dropdowns, then click **Load** to instantly fill the editor with the saved text.
- **Save row**: type a category and a name into the text fields, then click **Save** to store the current editor text for future use.
- Saved prompts persist across sessions and are shared between all Prompt Verify nodes.
- The status line below the rows confirms saves and loads with colour-coded feedback.

## Notes
- The node returns a single STRING output — the edited (or timed-out) text.
- Default timeout is 60s; maximum allowed timeout is 2400s.
- Panel size and position are remembered per node between executions.
- The floating editor panel can be dragged and resized freely.

Quick, and convenient text editing inside your ComfyUI flow.

MIT License

Developed by: ialhabbal
