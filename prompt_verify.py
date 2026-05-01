from server import PromptServer
from aiohttp import web
import time
import os
import json

class PromptVerify:
    RETURN_TYPES = ("CONDITIONING", "STRING")
    RETURN_NAMES = ("COND", "TEXT")
    FUNCTION = "func"
    CATEGORY = "text"

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "use_external_text_input": ("BOOLEAN", {"default": False, "label_on": "on", "label_off": "off", "tooltip": "Toggle to enable or disable the text connector input"}),
                "use_llm_input": ("BOOLEAN", {"default": False, "label_on": "on", "label_off": "off", "tooltip": "Toggle to use LLM input instead of the text input"}),
                "timeout": ("INT", { "default": 60, "min": 1, "max": 2400, "step": 1, "tooltip":"Time in seconds to wait before passing the input text on (max 2400)"}),
            },
            "optional": {
                "clip": ("CLIP", {"tooltip": "Optional CLIP model for encoding"}),
                "text" : ( "STRING", {"forceInput":True, "lazy": True}),
                "llm_input": ("STRING", {"multiline": True, "forceInput": True, "lazy": True, "tooltip": "Connect LLM text input here"}),
                "editor": ("STRING", {"default":"", "multiline":True, "tooltip":"edit here, press 'shift-return' to submit"}),
            },
            "hidden": {"node_id":"UNIQUE_ID"},
        }

    def check_lazy_status(self, use_external_text_input, use_llm_input, timeout, text=None, llm_input=None, editor=None, node_id=None, **kwargs):
        needed = []
        if use_external_text_input:
            needed.append("text")
        if use_llm_input:
            needed.append("llm_input")
        return needed

    def func(self, use_external_text_input, use_llm_input, timeout, node_id,
             text=None, llm_input=None, editor=None, clip=None):

        # Handle input selection logic
        if not use_external_text_input:
            text = None

        if use_llm_input and llm_input:
            text = llm_input

        # If only editor is used (no external/llm input)
        if text is None and editor:
            final_text = editor
            cond = self.encode_if_possible(clip, final_text)
            return (cond, final_text)

        # Normalize text
        if text is None:
            text = ""

        try:
            POBox.waiting[node_id] = self
            self.message = None

            PromptServer.instance.send_sync("prompt_verify_request", {
                "node_id": node_id,
                "message": text,
                "timeup": False,
            })

            endat = time.monotonic() + timeout
            while time.monotonic() < endat and self.message is None:
                time.sleep(0.1)

            # Timeout handling: notify UI, then allow 5 extra seconds for a final submission
            if self.message is None:
                PromptServer.instance.send_sync("prompt_verify_request", {
                    "node_id": node_id,
                    "timeup": True,
                })

                endat = time.monotonic() + 5
                while time.monotonic() < endat and self.message is None:
                    time.sleep(0.1)

            final_text = self.message or text
            cond = self.encode_if_possible(clip, final_text)

            return (cond, final_text)

        finally:
            POBox.waiting.pop(node_id, None)

    def encode_if_possible(self, clip, text):
        if clip is None:
            return None
        try:
            tokens = clip.tokenize(text)
            return clip.encode_from_tokens_scheduled(tokens)
        except Exception as e:
            print(f"[PromptVerify] CLIP encoding failed: {e}")
            return None


class POBox:
    waiting: dict[int, PromptVerify] = {}

    @classmethod
    def send(cls, node_id, message):
        if (the_node := cls.waiting.get(node_id, None)):
            the_node.message = message


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def _get_prompts_path():
    import folder_paths
    return os.path.join(folder_paths.get_user_directory(), "default", "prompt_verify_data.json")


def _load_prompts() -> dict:
    path = _get_prompts_path()
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[PromptVerify] Error loading prompts: {e}")
    return {}


def _sort_prompts_data(data: dict) -> dict:
    """Return a new dict with categories and their prompts both sorted
    case-insensitively. The special __meta__ key is always placed last
    within each category so it doesn't appear in the user-visible list."""
    sorted_data = {}
    for category in sorted(data.keys(), key=str.lower):
        cat_data = data[category]
        meta = cat_data.get("__meta__")
        sorted_prompts = dict(sorted(
            ((k, v) for k, v in cat_data.items() if k != "__meta__"),
            key=lambda item: item[0].lower()
        ))
        if meta is not None:
            sorted_prompts["__meta__"] = meta
        sorted_data[category] = sorted_prompts
    return sorted_data


def _save_prompts(data: dict) -> None:
    path = _get_prompts_path()
    sorted_data = _sort_prompts_data(data)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(sorted_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[PromptVerify] Error saving prompts: {e}")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

routes = PromptServer.instance.routes


@routes.post('/prompt_verify_response')
async def make_image_selection(request):
    post = await request.post()
    try:
        node_id = post['node_id']
        message = post.get('message', '')
    except Exception:
        return web.json_response({}, status=400)

    POBox.send(node_id, message)
    return web.json_response({})


@routes.get('/prompt_verify/get-prompts')
async def prompt_verify_get_prompts(request):
    try:
        prompts = _load_prompts()
        return web.json_response({"success": True, "prompts": prompts})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.post('/prompt_verify/save-prompt')
async def prompt_verify_save_prompt(request):
    try:
        data = await request.json()
        category = data.get("category", "").strip()
        name     = data.get("name",     "").strip()
        text     = data.get("text",     "").strip()

        if not category or not name:
            return web.json_response({"success": False, "error": "Category and name are required"}, status=400)

        # Reject saving an empty prompt
        if not text:
            return web.json_response({"success": False, "error": "Cannot save an empty prompt"}, status=400)

        prompts = _load_prompts()

        if category not in prompts:
            prompts[category] = {}

        # Case-insensitive duplicate detection: if a key exists with different
        # casing, warn the caller rather than silently renaming/overwriting.
        existing_lower = {k.lower(): k for k in prompts[category].keys() if k != "__meta__"}
        old_name = existing_lower.get(name.lower())
        if old_name is not None and old_name != name:
            # Different casing — preserve existing metadata but rename the key
            # so the new casing wins. Return a warning so the UI can surface it.
            existing_entry = prompts[category].pop(old_name)
            prompts[category][name] = existing_entry
            warning = f"Renamed existing entry '{old_name}' → '{name}' (casing changed)."
        else:
            warning = None

        # Preserve any existing metadata fields (loras, trigger words, etc.)
        existing = prompts[category].get(name, {})
        prompts[category][name] = {
            "prompt":        text,
            "loras_a":       existing.get("loras_a", []),
            "loras_b":       existing.get("loras_b", []),
            "trigger_words": existing.get("trigger_words", []),
            "thumbnail":     existing.get("thumbnail"),
        }
        if existing.get("nsfw"):
            prompts[category][name]["nsfw"] = existing["nsfw"]

        _save_prompts(prompts)
        response = {"success": True, "prompts": prompts}
        if warning:
            response["warning"] = warning
        return web.json_response(response)

    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.post('/prompt_verify/delete-prompt')
async def prompt_verify_delete_prompt(request):
    """Delete a single named prompt from a category.
    If the category becomes empty after deletion it is also removed."""
    try:
        data = await request.json()
        category = data.get("category", "").strip()
        name     = data.get("name",     "").strip()

        if not category or not name:
            return web.json_response({"success": False, "error": "Category and name are required"}, status=400)

        prompts = _load_prompts()

        if category not in prompts:
            return web.json_response({"success": False, "error": f"Category '{category}' not found"}, status=404)

        # Case-insensitive lookup so the UI can pass whatever casing it has
        existing_lower = {k.lower(): k for k in prompts[category].keys() if k != "__meta__"}
        real_name = existing_lower.get(name.lower())
        if real_name is None:
            return web.json_response({"success": False, "error": f"Prompt '{name}' not found in '{category}'"}, status=404)

        del prompts[category][real_name]

        # Drop the category entirely if it is now empty (ignoring __meta__)
        remaining = [k for k in prompts[category] if k != "__meta__"]
        if not remaining:
            del prompts[category]

        _save_prompts(prompts)
        return web.json_response({"success": True, "prompts": prompts})

    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.post('/prompt_verify/rename-category')
async def prompt_verify_rename_category(request):
    """Rename a category (move all its prompts to a new key)."""
    try:
        data     = await request.json()
        old_name = data.get("old_name", "").strip()
        new_name = data.get("new_name", "").strip()

        if not old_name or not new_name:
            return web.json_response({"success": False, "error": "Both old_name and new_name are required"}, status=400)

        if old_name == new_name:
            return web.json_response({"success": False, "error": "New name is identical to the old name"}, status=400)

        prompts = _load_prompts()

        if old_name not in prompts:
            return web.json_response({"success": False, "error": f"Category '{old_name}' not found"}, status=404)

        # Check for collision (case-insensitive)
        existing_lower = {k.lower(): k for k in prompts.keys()}
        collision = existing_lower.get(new_name.lower())
        if collision is not None and collision != old_name:
            return web.json_response(
                {"success": False, "error": f"A category named '{collision}' already exists"},
                status=409
            )

        prompts[new_name] = prompts.pop(old_name)
        _save_prompts(prompts)
        return web.json_response({"success": True, "prompts": prompts})

    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.get('/prompt_verify/export')
async def prompt_verify_export(request):
    """Return the full prompt library as a downloadable JSON file."""
    try:
        prompts = _load_prompts()
        body = json.dumps(prompts, indent=2, ensure_ascii=False)
        return web.Response(
            body=body.encode('utf-8'),
            content_type='application/json',
            headers={'Content-Disposition': 'attachment; filename="prompt_verify_data.json"'}
        )
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.post('/prompt_verify/import')
async def prompt_verify_import(request):
    """Merge an uploaded JSON prompt library into the existing one.
    Existing entries are overwritten only when the imported data has the
    same category + name key; all other existing entries are preserved."""
    try:
        imported = await request.json()
        if not isinstance(imported, dict):
            return web.json_response({"success": False, "error": "Expected a JSON object"}, status=400)

        prompts = _load_prompts()

        added = 0
        overwritten = 0
        for category, entries in imported.items():
            if not isinstance(entries, dict):
                continue
            if category not in prompts:
                prompts[category] = {}
            for name, value in entries.items():
                existed = name in prompts[category]
                prompts[category][name] = value
                if existed:
                    overwritten += 1
                else:
                    added += 1

        _save_prompts(prompts)
        return web.json_response({
            "success": True,
            "prompts": prompts,
            "added": added,
            "overwritten": overwritten,
        })

    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)
