from server import PromptServer
from aiohttp import web
import time
import os
import json

class PromptVerify:
    RETURN_TYPES = ("CONDITIONING", "STRING")   # ✅ swapped
    RETURN_NAMES = ("COND", "TEXT")             # ✅ swapped
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

        # If only editor is used
        if text is None and editor:
            final_text = editor
            cond = self.encode_if_possible(clip, final_text)
            return (cond, final_text)   # ✅ swapped order

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

            # Timeout handling
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

            return (cond, final_text)   # ✅ swapped order

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
    waiting:dict[int,PromptVerify] = {}

    @classmethod
    def send(cls, node_id, message):
        if (the_node := cls.waiting.get(node_id,None)):
            the_node.message = message


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


routes = PromptServer.instance.routes

@routes.post('/prompt_verify_response')
async def make_image_selection(request):
    post = await request.post()
    try:
        node_id = post['node_id']
        message = post.get('message','')
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

        prompts = _load_prompts()

        if category not in prompts:
            prompts[category] = {}

        existing_lower = {k.lower(): k for k in prompts[category].keys()}
        if name.lower() in existing_lower:
            old_name = existing_lower[name.lower()]
            if old_name != name:
                del prompts[category][old_name]

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
        return web.json_response({"success": True, "prompts": prompts})

    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)