from server import PromptServer
from aiohttp import web
import time

class PromptVerify:
    RETURN_TYPES = ("STRING",)
    FUNCTION = "func"
    CATEGORY = "text"

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "text" : ( "STRING", {"forceInput":True}),
                "timeout": ("INT", { "default": 60, "min": 1, "max": 2400, "step": 1, "tooltip":"Time in seconds to wait before passing the input text on (max 2400)"}),
            },
            "optional": {
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
    
    def func(self, text, timeout, node_id, editor=None, panel_default_width=520, panel_default_height=160, panel_min_width=320, panel_min_height=120, panel_pad_y=80):
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
