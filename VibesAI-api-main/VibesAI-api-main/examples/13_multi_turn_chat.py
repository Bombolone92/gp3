"""
Example 13: Multi-turn timeline chat with tool results.

Demonstrates the multi-turn chat flow:
1. Send an initial request
2. Receive a tool_call event
3. Execute the tool locally
4. Submit the tool result back to continue the conversation

Run:
    python examples/13_multi_turn_chat.py
"""
import os
import json
from vibes_api import VibesClient

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) Create a project for the chat to operate on
project = client.create_project(name="Chat Demo")
print(f"Project: {project['id']}")

# 2) Send the first message
print("\n=== Turn 1: Initial request ===")
print("User: 'Add a 5 second video of a sunset to the timeline'")

conversation_id = None
tool_calls = []

for event in client.timeline_chat("Add a 5 second video of a sunset to the timeline"):
    etype = event.get("type")
    if etype == "message_delta":
        print(f"Assistant: {event['delta']}", end="", flush=True)
    elif etype == "tool_call":
        tool_calls.append(event)
        print(f"\n  [tool_call] {event.get('name')}({event.get('arguments_buffer','')[:200]})")
    elif etype == "completed":
        conversation_id = event.get("conversation_id")
        print(f"\n  [completed] conversation_id={conversation_id}")
    elif etype == "error":
        print(f"\n  [error] {event.get('message')}")
        break

# 3) If there were tool calls, submit results
if tool_calls and conversation_id:
    for tc in tool_calls:
        call_id = tc.get("call_id")
        tool_name = tc.get("name")
        print(f"\n=== Turn 2: Submitting result for {tool_name} ===")

        # Simulate executing the tool
        result = {
            "success": True,
            "message": f"Added a 5 second sunset clip to the timeline",
            "clip_id": "chat-gen-sunset-001",
        }

        for event in client.submit_tool_result(
            conversation_id=conversation_id,
            tool_call_id=call_id,
            result=result,
            success=True,
            message=result["message"],
        ):
            etype = event.get("type")
            if etype == "message_delta":
                print(f"Assistant: {event['delta']}", end="", flush=True)
            elif etype == "completed":
                print(f"\n  [completed]")
                break
            elif etype == "error":
                print(f"\n  [error] {event.get('message')}")
                break

# 4) Continue the conversation
if conversation_id:
    print("\n=== Turn 3: Follow-up request ===")
    print("User: 'Now add calming background music'")

    messages = [
        {"role": "user", "content": "Add a 5 second video of a sunset to the timeline"},
        {"role": "assistant", "content": "Done! I've added the sunset clip."},
        {"role": "user", "content": "Now add calming background music"},
    ]

    for event in client.timeline_chat_multi_turn(
        messages=messages,
        conversation_id=conversation_id,
    ):
        etype = event.get("type")
        if etype == "message_delta":
            print(f"Assistant: {event['delta']}", end="", flush=True)
        elif etype == "tool_call":
            print(f"\n  [tool_call] {event.get('name')}")
        elif etype == "completed":
            print(f"\n  [completed]")
            break
        elif etype == "error":
            print(f"\n  [error] {event.get('message')}")
            break
