from server import PromptServer
from aiohttp import web
import time
import os
import json

class PromptVerify:
    RETURN_TYPES = ("STRING",)
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
                "text" : ( "STRING", {"forceInput":True, "lazy": True}),
                "llm_input": ("STRING", {"multiline": True, "forceInput": True, "lazy": True, "tooltip": "Connect LLM text input here"}),
                "editor": ("STRING", {"default":"", "multiline":True, "tooltip":"edit here, press 'shift-return' to submit"}),
                # Panel sizing options (pixels)
                "panel_default_width": ("INT", {"default":520, "min":200, "max":1600, "step":1, "tooltip":"Default panel width in pixels"}),
                "panel_default_height": ("INT", {"default":160, "min":80, "max":1200, "step":1, "tooltip":"Default panel height in pixels"}),
                "panel_min_width": ("INT", {"default":320, "min":100, "max":1200, "step":1, "tooltip":"Minimum panel width in pixels"}),
                "panel_min_height": ("INT", {"default":120, "min":60, "max":1200, "step":1, "tooltip":"Minimum panel height in pixels"}),
                "panel_pad_y": ("INT", {"default":80, "min":0, "max":400, "step":1, "tooltip":"Vertical padding used when computing textarea height"}),
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

    def func(self, use_external_text_input, use_llm_input, timeout, node_id, text=None, llm_input=None, editor=None, panel_default_width=520, panel_default_height=160, panel_min_width=320, panel_min_height=120, panel_pad_y=80):
        # If external text input toggle is off, ignore whatever is connected to text
        if not use_external_text_input:
            text = None

        # If LLM input toggle is on and llm_input is connected, use it as the source text
        if use_llm_input and llm_input:
            text = llm_input

        # If no connector input and the editor widget has content, pass it
        # directly downstream without opening the floating window.
        if text is None and editor:
            return (editor,)

        # Normalise: if text is None (no connector) treat as empty string.
        if text is None:
            text = ""

        # Interactive behaviour: send a request to the front-end and wait for the
        # user to submit edited text. If the front-end doesn't respond before
        # `timeout` seconds, send a timeup signal and wait a short grace period.
        try:
            POBox.waiting[node_id] = self
            self.message = None
            try:
                print(f"prompt_verify: sending prompt_verify_request node_id={node_id} message={repr(text)[:200]} timeup=False")
            except Exception:
                pass
            PromptServer.instance.send_sync("prompt_verify_request", {
                "node_id": node_id,
                "message": text,
                "timeup": False,
                "panel_defaults": {
                    "w": int(panel_default_width) if panel_default_width is not None else None,
                    "h": int(panel_default_height) if panel_default_height is not None else None,
                    "min_w": int(panel_min_width) if panel_min_width is not None else None,
                    "min_h": int(panel_min_height) if panel_min_height is not None else None,
                    "pad_y": int(panel_pad_y) if panel_pad_y is not None else None,
                }
            })
            endat = time.monotonic() + timeout
            while time.monotonic() < endat and self.message is None:
                time.sleep(0.1)
            if self.message is None:
                try:
                    print(f"prompt_verify: timeout reached, sending timeup for node_id={node_id}")
                except Exception:
                    pass
                PromptServer.instance.send_sync("prompt_verify_request", {"node_id": node_id, "timeup":True, "panel_defaults": {
                    "w": int(panel_default_width) if panel_default_width is not None else None,
                    "h": int(panel_default_height) if panel_default_height is not None else None,
                    "min_w": int(panel_min_width) if panel_min_width is not None else None,
                    "min_h": int(panel_min_height) if panel_min_height is not None else None,
                    "pad_y": int(panel_pad_y) if panel_pad_y is not None else None,
                }})
                endat = time.monotonic() + 5
                while time.monotonic() < endat and self.message is None:
                    time.sleep(0.1)
            return ( self.message or text, )
        finally:
            POBox.waiting.pop(node_id,None)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

# Update POBox typing to refer to the renamed class
class POBox:
    waiting:dict[int,PromptVerify] = {}
    @classmethod
    def send(cls, node_id, message):
        if (the_node := cls.waiting.get(node_id,None)):
            the_node.message = message

# ---------------------------------------------------------------------------
# Helpers shared with the save-prompt route
# ---------------------------------------------------------------------------

def _get_prompts_path():
    import folder_paths
    return os.path.join(folder_paths.get_user_directory(), "default", "prompt_verify_data.json")

def _load_prompts():
    path = _get_prompts_path()
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[PromptVerify] Error loading prompts: {e}")
    return {}

def _sort_prompts_data(data):
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

def _save_prompts(data):
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
        message = post.get('message','')
    except Exception:
        print('prompt_verify: malformed POST to /prompt_verify_response', post)
        return web.json_response({}, status=400)
    try:
        print(f"prompt_verify: /prompt_verify_response received node_id={node_id} message={repr(message)[:200]}")
    except Exception:
        pass
    POBox.send(node_id, message)
    return web.json_response({})


@routes.get('/prompt_verify/get-prompts')
async def prompt_verify_get_prompts(request):
    try:
        prompts = _load_prompts()
        return web.json_response({"success": True, "prompts": prompts})
    except Exception as e:
        print(f"[PromptVerify] Error in get-prompts: {e}")
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

        prompts = _load_prompts()

        if category not in prompts:
            prompts[category] = {}

        # Case-insensitive duplicate check — preserve casing of the new name
        existing_lower = {k.lower(): k for k in prompts[category].keys()}
        if name.lower() in existing_lower:
            old_name = existing_lower[name.lower()]
            if old_name != name:
                print(f"[PromptVerify] Removing old casing '{old_name}' before saving as '{name}'")
                del prompts[category][old_name]

        # Preserve any existing lora / trigger / thumbnail / nsfw data
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
        print(f"[PromptVerify] Saved prompt '{name}' in category '{category}'")
        return web.json_response({"success": True, "prompts": prompts})

    except Exception as e:
        print(f"[PromptVerify] Error in save-prompt: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)
