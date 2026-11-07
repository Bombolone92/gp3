"""
Example 4: Prompt enhancement and timeline AI chat.

Run:
    python examples/04_prompts_and_chat.py
"""
import os
from vibes_api import VibesClient

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) Enhance a short prompt into 4 detailed variations
print("=== Prompt Enhancement ===")
variations = client.enhance_prompt(prompt="a cat")
print(f"Got {len(variations)} variation(s):\n")
for i, v in enumerate(variations):
    print(f"--- Variation {i+1} ---")
    print(f"  IMAGE prompt: {v['image'][:200]}...")
    print(f"  VIDEO prompt: {v['video'][:200]}...")
    print()

# 2) Use the timeline AI chat to plan a video
print("\n=== Timeline AI Chat ===")
project = client.create_project(name="Chat-Driven Video")
print(f"Project: {project['id']}")
print("Asking the AI to plan a 15-second video about coffee...\n")

for event in client.timeline_chat(
    user_input="Generate a 15 second video showing the process of making coffee, "
               "from beans to a finished cup. Use 3 clips of 5 seconds each."
):
    etype = event.get("type")
    if etype == "message_delta":
        print(event.get("delta", ""), end="", flush=True)
    elif etype == "tool_call":
        print(f"\n  [tool_call] {event.get('name')}")
    elif etype == "completed":
        print(f"\n  [completed] conversation_id={event.get('conversation_id')}")
    elif etype == "error":
        print(f"\n  [error] {event.get('message')}")
