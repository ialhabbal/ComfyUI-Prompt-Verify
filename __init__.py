from .prompt_verify import PromptVerify

VERSION = "0.0.1"

# map display name -> class object
NODE_CLASS_MAPPINGS = {"Prompt Verify": PromptVerify}

WEB_DIRECTORY = "./js"
__all__ = ["VERSION", "NODE_CLASS_MAPPINGS", "WEB_DIRECTORY"]