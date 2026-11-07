"""CLI entrypoint for the Vibes API client.

Usage
-----
    vibes-api --cookie <meta_session> me
    vibes-api --cookie <meta_session> projects list
    vibes-api --cookie <meta_session> projects create --name "My Video"
    vibes-api --cookie <meta_session> videos generate \\
        --project-id <id> \\
        --prompt "sunset over ocean" \\
        --aspect-ratio 16:9 \\
        --resolution 720p \\
        --variations 4 \\
        --download-dir ./out
    vibes-api --cookie <meta_session> images generate \\
        --project-id <id> --prompt "cyberpunk city"
    vibes-api --cookie <meta_session> voices list
    vibes-api --cookie <meta_session> tts --voice play_ai_Marisol \\
        --text "Hello world" --out hello.mp3
    vibes-api --cookie <meta_session> media list
    vibes-api --cookie <meta_session> media download --id <id> --out video.mp4
    vibes-api --cookie <meta_session> prompts enhance --prompt "a cat"
    vibes-api --cookie <meta_session> ingredients list
    vibes-api --cookie <meta_session> share create --entity-type project --entity-id <id>

You can also set VIBES_META_SESSION env var instead of --cookie.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from .client import VibesClient, VibesAPIError


def _client(args: argparse.Namespace) -> VibesClient:
    cookie = args.cookie or os.environ.get("VIBES_META_SESSION")
    if not cookie:
        sys.exit("error: --cookie is required (or set VIBES_META_SESSION env var)")
    return VibesClient(meta_session=cookie)


def _print(obj: Any) -> None:
    if isinstance(obj, (dict, list)):
        print(json.dumps(obj, indent=2, default=str))
    else:
        print(obj)


def cmd_me(client: VibesClient, args: argparse.Namespace) -> None:
    _print(client.get_me())


def cmd_projects_list(client: VibesClient, args: argparse.Namespace) -> None:
    _print(client.list_projects(limit=args.limit, offset=args.offset, search=args.search))


def cmd_projects_create(client: VibesClient, args: argparse.Namespace) -> None:
    _print(client.create_project(name=args.name))


def cmd_projects_get(client: VibesClient, args: argparse.Namespace) -> None:
    _print(client.get_project(args.project_id))


def cmd_projects_delete(client: VibesClient, args: argparse.Namespace) -> None:
    client.delete_project(args.project_id, delete_assets=args.delete_assets)
    print(f"Deleted project {args.project_id}")


def cmd_videos_generate(client: VibesClient, args: argparse.Namespace) -> None:
    print(f"Generating {args.variations} video variation(s)...", file=sys.stderr)
    result = client.generate_video(
        project_id=args.project_id,
        prompt=args.prompt,
        aspect_ratio=args.aspect_ratio,
        resolution=args.resolution,
        variations=args.variations,
        poll=not args.no_poll,
    )
    if args.no_poll:
        _print(result)
        return
    # Summarize
    videos = [
        {"id": c.get("id"), "videoUrl": c.get("videoUrl"),
         "imageUrl": c.get("imageUrl"), "prompt": c.get("prompt")}
        for c in result.get("content", []) if c.get("videoUrl")
    ]
    print(f"Generated {len(videos)} video(s):", file=sys.stderr)
    for v in videos:
        print(f"  - id={v['id']}", file=sys.stderr)
        print(f"    videoUrl={v['videoUrl'][:80]}..." if v["videoUrl"] else "", file=sys.stderr)
    if args.download_dir:
        os.makedirs(args.download_dir, exist_ok=True)
        for i, v in enumerate(videos):
            out = os.path.join(args.download_dir, f"video_{i}.mp4")
            try:
                client.download_video(v["id"], out)
                print(f"  downloaded → {out}", file=sys.stderr)
            except Exception as e:
                print(f"  download failed: {e}", file=sys.stderr)
    _print({"videos": videos, "batch_id": result.get("id")})


def cmd_images_generate(client: VibesClient, args: argparse.Namespace) -> None:
    print(f"Generating {args.variations} image(s)...", file=sys.stderr)
    resp = client.generate_image(
        project_id=args.project_id,
        prompt=args.prompt,
        aspect_ratio=args.aspect_ratio,
        variations=args.variations,
    )
    images = [
        {"url": d.get("url"), "prompt": d.get("prompt"),
         "imageEntId": d.get("imageEntId"), "dimensions": d.get("dimensions")}
        for d in resp.get("data", [])
    ]
    print(f"Generated {len(images)} image(s):", file=sys.stderr)
    for im in images:
        print(f"  - {im['url'][:80]}...", file=sys.stderr)
    if args.download_dir:
        os.makedirs(args.download_dir, exist_ok=True)
        for i, im in enumerate(images):
            out = os.path.join(args.download_dir, f"image_{i}.png")
            try:
                # Download via direct URL
                import requests
                r = requests.get(im["url"], timeout=60)
                r.raise_for_status()
                with open(out, "wb") as f:
                    f.write(r.content)
                print(f"  downloaded → {out}", file=sys.stderr)
            except Exception as e:
                print(f"  download failed: {e}", file=sys.stderr)
    _print({"images": images, "batch": resp.get("updatedBatch", {}).get("id")})


def cmd_voices_list(client: VibesClient, args: argparse.Namespace) -> None:
    voices = client.list_voices()
    print(f"{len(voices)} voice(s) available:\n", file=sys.stderr)
    for v in voices:
        print(f"  {v['id']:35s}  {v['name']:20s}  {v.get('description','')}", file=sys.stderr)
    _print(voices)


def cmd_tts(client: VibesClient, args: argparse.Namespace) -> None:
    print(f"Synthesizing with voice '{args.voice}'...", file=sys.stderr)
    resp = client.tts(text=args.text, voice=args.voice, language=args.language)
    if "audioBase64" not in resp:
        _print(resp)
        return
    client.save_tts_audio(resp, args.out)
    print(f"saved → {args.out}", file=sys.stderr)


def cmd_media_list(client: VibesClient, args: argparse.Namespace) -> None:
    _print(client.list_media(limit=args.limit, offset=args.offset, type=args.type))


def cmd_media_download(client: VibesClient, args: argparse.Namespace) -> None:
    if args.type == "image":
        client.download_image(args.id, args.out)
    else:
        client.download_video(args.id, args.out)
    print(f"saved → {args.out}", file=sys.stderr)


def cmd_media_delete(client: VibesClient, args: argparse.Namespace) -> None:
    client.delete_content_items(args.ids)
    print(f"deleted {len(args.ids)} item(s)")


def cmd_prompts_enhance(client: VibesClient, args: argparse.Namespace) -> None:
    variations = client.enhance_prompt(prompt=args.prompt, batch_type=args.batch_type)
    print(f"{len(variations)} variation(s):", file=sys.stderr)
    _print(variations)


def cmd_ingredients_list(client: VibesClient, args: argparse.Namespace) -> None:
    items = client.list_ingredients(owner_filter=args.owner_filter)
    print(f"{len(items)} ingredient(s):", file=sys.stderr)
    for it in items:
        print(f"  [{it.get('ingredientType')}] {it.get('name')} (id={it.get('ingredientId')})", file=sys.stderr)
    _print(items)


def cmd_share_create(client: VibesClient, args: argparse.Namespace) -> None:
    link = client.create_share_link(args.entity_type, args.entity_id)
    print(f"Share URL: {link.get('url')}", file=sys.stderr)
    _print(link)


def cmd_share_list(client: VibesClient, args: argparse.Namespace) -> None:
    _print(client.list_share_links(args.entity_type, args.entity_id))


def cmd_share_revoke(client: VibesClient, args: argparse.Namespace) -> None:
    client.revoke_share_link(args.share_link_id)
    print(f"revoked {args.share_link_id}")


def cmd_batches_list(client: VibesClient, args: argparse.Namespace) -> None:
    _print(client.list_batches(limit=args.limit, offset=args.offset, project_id=args.project_id))


def cmd_batches_get(client: VibesClient, args: argparse.Namespace) -> None:
    _print(client.get_batch(args.batch_id))


def cmd_batches_poll(client: VibesClient, args: argparse.Namespace) -> None:
    print(f"Polling batch {args.batch_id} (timeout {args.timeout}s)...", file=sys.stderr)
    batch = client.poll_batch(args.batch_id, timeout=args.timeout)
    _print(batch)


def cmd_music_search(client: VibesClient, args: argparse.Namespace) -> None:
    _print(client.search_music(query=args.query, limit=args.limit))


def cmd_timeline_chat(client: VibesClient, args: argparse.Namespace) -> None:
    print(f"Streaming timeline chat for: {args.input}", file=sys.stderr)
    for event in client.timeline_chat(args.input):
        etype = event.get("type")
        if etype == "message_delta":
            print(event.get("delta", ""), end="", flush=True)
        elif etype == "message_done":
            print()
        elif etype == "tool_call":
            print(f"\n[tool_call] {event.get('name')}({event.get('arguments_buffer','')[:200]})",
                  file=sys.stderr)
        elif etype == "error":
            print(f"\n[error] {event.get('code')}: {event.get('message')}", file=sys.stderr)
        elif etype == "completed":
            print(f"\n[completed] conversation_id={event.get('conversation_id')}", file=sys.stderr)
        else:
            _print(event)


def cmd_one_shot(client: VibesClient, args: argparse.Namespace) -> None:
    print(f"Creating end-to-end video for: {args.prompt}", file=sys.stderr)
    result = client.create_video_from_prompt(
        prompt=args.prompt,
        project_name=args.name,
        aspect_ratio=args.aspect_ratio,
        resolution=args.resolution,
        variations=args.variations,
        download_dir=args.download_dir,
    )
    _print(result)


# ----- NEW COMMANDS: extend, edit_video, animate, regenerate, ingredient CRUD, sync -----

def cmd_videos_extend(client: VibesClient, args: argparse.Namespace) -> None:
    """Extend a video (auto or manual)."""
    # Fetch the source content item from the batch
    batch = client.get_batch(args.batch_id)
    source = None
    for c in batch.get("content", []):
        if c["id"] == args.content_id:
            source = c
            break
    if not source:
        # Try to use the first content item
        if batch.get("content"):
            source = batch["content"][0]
        else:
            sys.exit(f"Content item {args.content_id} not found in batch {args.batch_id}")
    mode = "manual" if args.prompt else "auto"
    print(f"Extend ({mode}) on {source['id']}...", file=sys.stderr)
    result = client.extend_video(
        project_id=args.project_id,
        source_video=source,
        prompt=args.prompt,
        poll=not args.no_poll,
    )
    if args.no_poll:
        _print(result)
        return
    videos = [{"id": c.get("id"), "videoUrl": c.get("videoUrl")}
              for c in result.get("content", []) if c.get("videoUrl")]
    print(f"Extended: {len(videos)} video(s)", file=sys.stderr)
    for v in videos:
        print(f"  - {v['id']}: {v['videoUrl'][:80]}...", file=sys.stderr)
    _print({"videos": videos, "batch_id": result.get("id")})


def cmd_videos_edit(client: VibesClient, args: argparse.Namespace) -> None:
    """Video-to-video edit (re-render with a directive)."""
    batch = client.get_batch(args.batch_id)
    source = None
    for c in batch.get("content", []):
        if c["id"] == args.content_id:
            source = c
            break
    if not source:
        if batch.get("content"):
            source = batch["content"][0]
        else:
            sys.exit(f"Content item not found in batch {args.batch_id}")
    print(f"Editing video {source['id']} with prompt: {args.prompt}", file=sys.stderr)
    result = client.edit_video(
        project_id=args.project_id,
        source_video=source,
        prompt=args.prompt,
        poll=not args.no_poll,
    )
    _print(result if args.no_poll else {
        "batch_id": result.get("id"),
        "videos": [{"id": c.get("id"), "videoUrl": c.get("videoUrl")}
                   for c in result.get("content", []) if c.get("videoUrl")],
    })


def cmd_images_animate(client: VibesClient, args: argparse.Namespace) -> None:
    """Animate an image (auto or manual)."""
    # Image content items are in image batches; we need to fetch them.
    # Use the media library to find the source image.
    media = client.list_media(limit=100)
    source = None
    for item in media["items"]:
        if item["id"] == args.content_id:
            # Reconstruct a content-item-shaped dict
            source = {
                "id": item["id"],
                "imageUrl": item.get("thumbnailUrl") or item.get("fullUrl"),
                "prompt": item.get("prompt", ""),
                "type": "images",
            }
            break
    if not source:
        sys.exit(f"Content item {args.content_id} not found in media library")
    mode = "manual" if args.prompt else "auto"
    print(f"Animate ({mode}) on {source['id']}...", file=sys.stderr)
    result = client.animate_image(
        project_id=args.project_id,
        source_image=source,
        prompt=args.prompt,
        poll=not args.no_poll,
    )
    _print(result if args.no_poll else {
        "batch_id": result.get("id"),
        "videos": [{"id": c.get("id"), "videoUrl": c.get("videoUrl")}
                   for c in result.get("content", []) if c.get("videoUrl")],
    })


def cmd_batches_regenerate(client: VibesClient, args: argparse.Namespace) -> None:
    """Regenerate a batch (re-roll)."""
    print(f"Regenerating batch {args.batch_id}...", file=sys.stderr)
    result = client.regenerate_batch(
        project_id=args.project_id,
        batch_id=args.batch_id,
        prompt=args.prompt,
        poll=not args.no_poll,
    )
    _print(result if args.no_poll else {
        "batch_id": result.get("id"),
        "isComplete": result.get("isComplete"),
        "content_count": len(result.get("content", [])),
    })


def cmd_ingredients_create(client: VibesClient, args: argparse.Namespace) -> None:
    """Create a new ingredient."""
    result = client.create_ingredient(
        name=args.name,
        ingredient_type=args.type,
        source_image_ent_id=args.image_ent_id,
        image_url=args.image_url,
        description=args.description,
    )
    print(f"Created ingredient: {result.get('ingredient', {}).get('ingredientId')}", file=sys.stderr)
    if result.get("usedExistingName"):
        print("(used existing name — ingredient with this name already existed)", file=sys.stderr)
    _print(result)


def cmd_ingredients_delete(client: VibesClient, args: argparse.Namespace) -> None:
    """Delete an ingredient."""
    client.delete_ingredient(args.ingredient_id)
    print(f"Deleted ingredient {args.ingredient_id}", file=sys.stderr)


def cmd_sync_status(client: VibesClient, args: argparse.Namespace) -> None:
    """Get sync status for an entity."""
    result = client.get_sync_status(args.entity_type, args.entity_id)
    _print(result)


def cmd_sync_stream(client: VibesClient, args: argparse.Namespace) -> None:
    """Stream sync updates (Ctrl+C to stop)."""
    print(f"Streaming updates for {args.entity_type} {args.entity_id} (Ctrl+C to stop)...",
          file=sys.stderr)
    try:
        for event in client.stream_sync_updates(args.entity_type, args.entity_id):
            _print(event)
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)


def cmd_quota(client: VibesClient, args: argparse.Namespace) -> None:
    """Get quota upsell info."""
    result = client.get_quota_upsell()
    if result is None:
        print("No upsell info available (user not eligible or endpoint failed).")
    else:
        _print(result)


# ----- v1.2.0 commands -----

def cmd_publish(client: VibesClient, args: argparse.Namespace) -> None:
    """Publish a content item to Vibes."""
    print(f"Publishing content item {args.content_id}...", file=sys.stderr)
    result = client.publish_to_vibes(
        content_item_id=args.content_id,
        batch_id=args.batch_id,
        caption=args.caption,
        prompt=args.prompt,
        image_prompt=args.image_prompt,
        video_prompt=args.video_prompt,
    )
    _print(result)


def cmd_moodboard_update(client: VibesClient, args: argparse.Namespace) -> None:
    """Update a moodboard (rename / add / remove images)."""
    result = client.update_moodboard(
        moodboard_id=args.moodboard_id,
        name=args.name,
    )
    _print(result)


def cmd_moodboard_lookup(client: VibesClient, args: argparse.Namespace) -> None:
    """Look up a moodboard ID by code."""
    moodboard_id = client.lookup_moodboard_by_code(args.code)
    if moodboard_id:
        print(moodboard_id)
    else:
        print(f"No moodboard found with code '{args.code}'", file=sys.stderr)
        sys.exit(1)


def cmd_share_reset(client: VibesClient, args: argparse.Namespace) -> None:
    """Reset share link (revoke existing + create new)."""
    print(f"Resetting share link for {args.entity_type} {args.entity_id}...", file=sys.stderr)
    result = client.reset_share_link(args.entity_type, args.entity_id)
    print(f"New share URL: {result.get('url')}", file=sys.stderr)
    _print(result)


def cmd_playables_list(client: VibesClient, args: argparse.Namespace) -> None:
    """List playables."""
    _print(client.list_playables(limit=args.limit, offset=args.offset, status=args.status))


def cmd_playables_get(client: VibesClient, args: argparse.Namespace) -> None:
    """Get a playable."""
    _print(client.get_playable(args.playable_id))


def cmd_playables_delete(client: VibesClient, args: argparse.Namespace) -> None:
    """Delete a playable."""
    client.delete_playable(args.playable_id)
    print(f"Deleted playable {args.playable_id}", file=sys.stderr)


def cmd_ingredients_update(client: VibesClient, args: argparse.Namespace) -> None:
    """Update an ingredient."""
    result = client.update_ingredient(
        ingredient_id=args.ingredient_id,
        name=args.name,
        description=args.description,
        personality=args.personality,
        backstory=args.backstory,
        core_beliefs=args.core_beliefs,
    )
    _print(result)


def cmd_audio_resolve(client: VibesClient, args: argparse.Namespace) -> None:
    """Resolve audio URLs for a list of audio cluster IDs."""
    result = client.resolve_audio_urls(args.ids)
    _print(result)


def cmd_audio_proxy(client: VibesClient, args: argparse.Namespace) -> None:
    """Build a proxy audio URL."""
    url = client.proxy_audio_url(args.audio_id, title=args.title)
    print(url)


def cmd_check_token(client: VibesClient, args: argparse.Namespace) -> None:
    """Check if the current session token is valid."""
    if client.check_token():
        print("✓ Token is valid")
    else:
        print("✗ Token is INVALID (session expired)")
        sys.exit(1)


def cmd_rate_limit(client: VibesClient, args: argparse.Namespace) -> None:
    """Show current rate limit status."""
    _print(client.get_rate_limit_status())


def cmd_pending_export(client: VibesClient, args: argparse.Namespace) -> None:
    """Check if a project has a pending export."""
    result = client.get_pending_export(args.project_id)
    if result:
        print("Pending export found:", file=sys.stderr)
        _print(result)
    else:
        print("No pending export.", file=sys.stderr)


def cmd_parse_midjourney(client: VibesClient, args: argparse.Namespace) -> None:
    """Parse Midjourney parameters from a prompt."""
    result = VibesClient.parse_midjourney_params(args.prompt)
    _print(result)


def cmd_validate_prompt(client: VibesClient, args: argparse.Namespace) -> None:
    """Validate a prompt's length."""
    result = VibesClient.validate_prompt_length(args.prompt)
    if result["success"]:
        print(f"✓ Valid ({len(result['value'])} chars)")
    else:
        print(f"✗ {result['error']}")
        sys.exit(1)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="vibes-api", description="Vibes.ai API CLI")
    p.add_argument("--cookie", help="meta_session cookie value (or set VIBES_META_SESSION env var)")
    sub = p.add_subparsers(dest="cmd", required=True)

    # me
    sub.add_parser("me", help="Get current user").set_defaults(func=cmd_me)

    # projects
    proj = sub.add_parser("projects", help="Project management")
    proj_sub = proj.add_subparsers(dest="subcmd", required=True)
    proj_list = proj_sub.add_parser("list", help="List projects")
    proj_list.add_argument("--limit", type=int, default=25)
    proj_list.add_argument("--offset", type=int, default=0)
    proj_list.add_argument("--search", type=str)
    proj_list.set_defaults(func=cmd_projects_list)
    proj_create = proj_sub.add_parser("create", help="Create a project")
    proj_create.add_argument("--name", default="Untitled")
    proj_create.set_defaults(func=cmd_projects_create)
    proj_get = proj_sub.add_parser("get", help="Get a project")
    proj_get.add_argument("project_id")
    proj_get.set_defaults(func=cmd_projects_get)
    proj_del = proj_sub.add_parser("delete", help="Delete a project")
    proj_del.add_argument("project_id")
    proj_del.add_argument("--delete-assets", action="store_true")
    proj_del.set_defaults(func=cmd_projects_delete)

    # videos
    vid = sub.add_parser("videos", help="Video generation")
    vid_sub = vid.add_subparsers(dest="subcmd", required=True)
    vid_gen = vid_sub.add_parser("generate", help="Generate videos from a prompt")
    vid_gen.add_argument("--project-id", required=True)
    vid_gen.add_argument("--prompt", required=True)
    vid_gen.add_argument("--aspect-ratio", default="9:16", choices=["1:1","9:16","16:9","4:5","3:2","2:3"])
    vid_gen.add_argument("--resolution", default="480p", choices=["480p","720p"])
    vid_gen.add_argument("--variations", type=int, default=4)
    vid_gen.add_argument("--download-dir", help="If set, download MP4s to this dir")
    vid_gen.add_argument("--no-poll", action="store_true", help="Return immediately without waiting")
    vid_gen.set_defaults(func=cmd_videos_generate)

    # videos extend (auto/manual)
    vid_ext = vid_sub.add_parser("extend", help="Extend a video (auto or manual)")
    vid_ext.add_argument("--project-id", required=True)
    vid_ext.add_argument("--batch-id", required=True, help="Batch containing the source video")
    vid_ext.add_argument("--content-id", help="Specific content item ID (default: first)")
    vid_ext.add_argument("--prompt", help="Manual extend directive (omit for auto extend)")
    vid_ext.add_argument("--no-poll", action="store_true")
    vid_ext.set_defaults(func=cmd_videos_extend)

    # videos edit (v2v)
    vid_edit = vid_sub.add_parser("edit", help="Edit a video with a prompt (v2v)")
    vid_edit.add_argument("--project-id", required=True)
    vid_edit.add_argument("--batch-id", required=True)
    vid_edit.add_argument("--content-id")
    vid_edit.add_argument("--prompt", required=True, help="Edit directive")
    vid_edit.add_argument("--no-poll", action="store_true")
    vid_edit.set_defaults(func=cmd_videos_edit)

    # images
    img = sub.add_parser("images", help="Image generation")
    img_sub = img.add_subparsers(dest="subcmd", required=True)
    img_gen = img_sub.add_parser("generate", help="Generate images from a prompt")
    img_gen.add_argument("--project-id", required=True)
    img_gen.add_argument("--prompt", required=True)
    img_gen.add_argument("--aspect-ratio", default="1:1", choices=["1:1","9:16","16:9","4:5","3:2","2:3"])
    img_gen.add_argument("--variations", type=int, default=1)
    img_gen.add_argument("--download-dir")
    img_gen.set_defaults(func=cmd_images_generate)

    # images animate (auto/manual)
    img_anim = img_sub.add_parser("animate", help="Animate an image (auto or manual)")
    img_anim.add_argument("--project-id", required=True)
    img_anim.add_argument("--content-id", required=True, help="Image content item ID")
    img_anim.add_argument("--prompt", help="Manual animate directive (omit for auto)")
    img_anim.add_argument("--no-poll", action="store_true")
    img_anim.set_defaults(func=cmd_images_animate)

    # voices / tts
    sub.add_parser("voices", help="List TTS voices").set_defaults(func=cmd_voices_list)
    tts = sub.add_parser("tts", help="Text-to-speech")
    tts.add_argument("--voice", required=True)
    tts.add_argument("--text", required=True)
    tts.add_argument("--out", required=True, help="Output mp3 path")
    tts.add_argument("--language")
    tts.set_defaults(func=cmd_tts)

    # media
    med = sub.add_parser("media", help="Media library")
    med_sub = med.add_subparsers(dest="subcmd", required=True)
    med_list = med_sub.add_parser("list", help="List media items")
    med_list.add_argument("--limit", type=int, default=50)
    med_list.add_argument("--offset", type=int, default=0)
    med_list.add_argument("--type", choices=["video","image","audio"])
    med_list.set_defaults(func=cmd_media_list)
    med_dl = med_sub.add_parser("download", help="Download a media item")
    med_dl.add_argument("--id", required=True)
    med_dl.add_argument("--out", required=True)
    med_dl.add_argument("--type", default="video", choices=["video","image"])
    med_dl.set_defaults(func=cmd_media_download)
    med_del = med_sub.add_parser("delete", help="Delete media items")
    med_del.add_argument("--ids", nargs="+", required=True)
    med_del.set_defaults(func=cmd_media_delete)

    # prompts
    pr = sub.add_parser("prompts", help="Prompt enhancement")
    pr_sub = pr.add_subparsers(dest="subcmd", required=True)
    pr_enh = pr_sub.add_parser("enhance", help="Generate 4 enhanced prompt variations")
    pr_enh.add_argument("--prompt", required=True)
    pr_enh.add_argument("--batch-type", default="videos", choices=["videos","images"])
    pr_enh.set_defaults(func=cmd_prompts_enhance)

    # ingredients
    ing = sub.add_parser("ingredients", help="Studio ingredients")
    ing_sub = ing.add_subparsers(dest="subcmd", required=True)
    ing_list = ing_sub.add_parser("list", help="List ingredients")
    ing_list.add_argument("--owner-filter", default="LIBRARY", choices=["LIBRARY","VIEWER"])
    ing_list.add_argument("--type", choices=["CHARACTER","STYLE","SETTING"],
                          help="Filter to one type")
    ing_list.set_defaults(func=cmd_ingredients_list)
    ing_cr = ing_sub.add_parser("create", help="Create an ingredient")
    ing_cr.add_argument("--name", required=True)
    ing_cr.add_argument("--type", required=True, choices=["CHARACTER","STYLE","SETTING"])
    ing_cr.add_argument("--image-ent-id", help="Source image entity ID (from upload_image)")
    ing_cr.add_argument("--image-url", help="Source image URL")
    ing_cr.add_argument("--description")
    ing_cr.set_defaults(func=cmd_ingredients_create)
    ing_del = ing_sub.add_parser("delete", help="Delete an ingredient")
    ing_del.add_argument("ingredient_id")
    ing_del.set_defaults(func=cmd_ingredients_delete)

    # share
    sh = sub.add_parser("share", help="Share links")
    sh_sub = sh.add_subparsers(dest="subcmd", required=True)
    sh_cr = sh_sub.add_parser("create", help="Create a share link")
    sh_cr.add_argument("--entity-type", required=True, choices=["project","content-item"])
    sh_cr.add_argument("--entity-id", required=True)
    sh_cr.set_defaults(func=cmd_share_create)
    sh_ls = sh_sub.add_parser("list", help="List share links")
    sh_ls.add_argument("--entity-type", required=True)
    sh_ls.add_argument("--entity-id", required=True)
    sh_ls.set_defaults(func=cmd_share_list)
    sh_rv = sh_sub.add_parser("revoke", help="Revoke a share link")
    sh_rv.add_argument("share_link_id")
    sh_rv.set_defaults(func=cmd_share_revoke)

    # batches
    bt = sub.add_parser("batches", help="Generation batches")
    bt_sub = bt.add_subparsers(dest="subcmd", required=True)
    bt_ls = bt_sub.add_parser("list", help="List batches")
    bt_ls.add_argument("--limit", type=int, default=12)
    bt_ls.add_argument("--offset", type=int, default=0)
    bt_ls.add_argument("--project-id")
    bt_ls.set_defaults(func=cmd_batches_list)
    bt_gt = bt_sub.add_parser("get", help="Get a batch")
    bt_gt.add_argument("batch_id")
    bt_gt.set_defaults(func=cmd_batches_get)
    bt_pl = bt_sub.add_parser("poll", help="Poll until a batch completes")
    bt_pl.add_argument("batch_id")
    bt_pl.add_argument("--timeout", type=float, default=180.0)
    bt_pl.set_defaults(func=cmd_batches_poll)
    bt_rg = bt_sub.add_parser("regenerate", help="Regenerate a batch (re-roll)")
    bt_rg.add_argument("batch_id")
    bt_rg.add_argument("--project-id", required=True)
    bt_rg.add_argument("--prompt", help="Override the original prompt")
    bt_rg.add_argument("--no-poll", action="store_true")
    bt_rg.set_defaults(func=cmd_batches_regenerate)

    # music
    mu = sub.add_parser("music", help="Music library")
    mu_sub = mu.add_subparsers(dest="subcmd", required=True)
    mu_se = mu_sub.add_parser("search", help="Search music")
    mu_se.add_argument("--query", default="")
    mu_se.add_argument("--limit", type=int, default=30)
    mu_se.set_defaults(func=cmd_music_search)

    # timeline chat
    tc = sub.add_parser("chat", help="Stream timeline AI chat")
    tc.add_argument("input", help="Your request, e.g. 'add a 5s sunset clip'")
    tc.set_defaults(func=cmd_timeline_chat)

    # one-shot
    os_p = sub.add_parser("one-shot", help="End-to-end: create project + generate + download")
    os_p.add_argument("--prompt", required=True)
    os_p.add_argument("--name")
    os_p.add_argument("--aspect-ratio", default="16:9", choices=["1:1","9:16","16:9","4:5","3:2","2:3"])
    os_p.add_argument("--resolution", default="720p", choices=["480p","720p"])
    os_p.add_argument("--variations", type=int, default=4)
    os_p.add_argument("--download-dir")
    os_p.set_defaults(func=cmd_one_shot)

    # sync (real-time SSE)
    syn = sub.add_parser("sync", help="Real-time sync (collaborative editing)")
    syn_sub = syn.add_subparsers(dest="subcmd", required=True)
    syn_st = syn_sub.add_parser("status", help="Get last-updated timestamp")
    syn_st.add_argument("--entity-type", required=True, choices=["project","content-item"])
    syn_st.add_argument("--entity-id", required=True)
    syn_st.set_defaults(func=cmd_sync_status)
    syn_sm = syn_sub.add_parser("stream", help="Stream SSE updates (Ctrl+C to stop)")
    syn_sm.add_argument("--entity-type", required=True, choices=["project","content-item"])
    syn_sm.add_argument("--entity-id", required=True)
    syn_sm.set_defaults(func=cmd_sync_stream)

    # quota
    sub.add_parser("quota", help="Show quota / upsell info").set_defaults(func=cmd_quota)

    # ----- v1.2.0 subcommands -----

    # publish
    pub = sub.add_parser("publish", help="Publish a content item to Vibes")
    pub.add_argument("--content-id", required=True)
    pub.add_argument("--batch-id")
    pub.add_argument("--caption")
    pub.add_argument("--prompt")
    pub.add_argument("--image-prompt")
    pub.add_argument("--video-prompt")
    pub.set_defaults(func=cmd_publish)

    # moodboard update
    mb_up = sub.add_parser("moodboard-update", help="Update a moodboard")
    mb_up.add_argument("moodboard_id")
    mb_up.add_argument("--name", help="New name for the moodboard")
    mb_up.set_defaults(func=cmd_moodboard_update)

    # moodboard lookup
    mb_lk = sub.add_parser("moodboard-lookup", help="Look up moodboard ID by code")
    mb_lk.add_argument("code")
    mb_lk.set_defaults(func=cmd_moodboard_lookup)

    # share reset
    sh_rs = sub.add_parser("share-reset", help="Reset share link (revoke + create new)")
    sh_rs.add_argument("--entity-type", required=True, choices=["project","content-item"])
    sh_rs.add_argument("--entity-id", required=True)
    sh_rs.set_defaults(func=cmd_share_reset)

    # playables
    plb = sub.add_parser("playables", help="Playables (interactive posts)")
    plb_sub = plb.add_subparsers(dest="subcmd", required=True)
    plb_ls = plb_sub.add_parser("list", help="List playables")
    plb_ls.add_argument("--limit", type=int, default=100)
    plb_ls.add_argument("--offset", type=int, default=0)
    plb_ls.add_argument("--status")
    plb_ls.set_defaults(func=cmd_playables_list)
    plb_gt = plb_sub.add_parser("get", help="Get a playable")
    plb_gt.add_argument("playable_id")
    plb_gt.set_defaults(func=cmd_playables_get)
    plb_del = plb_sub.add_parser("delete", help="Delete a playable")
    plb_del.add_argument("playable_id")
    plb_del.set_defaults(func=cmd_playables_delete)

    # ingredient update
    ing_up = sub.add_parser("ingredients-update", help="Update an ingredient")
    ing_up.add_argument("ingredient_id")
    ing_up.add_argument("--name")
    ing_up.add_argument("--description")
    ing_up.add_argument("--personality")
    ing_up.add_argument("--backstory")
    ing_up.add_argument("--core-beliefs")
    ing_up.set_defaults(func=cmd_ingredients_update)

    # audio resolve
    aud_rs = sub.add_parser("audio-resolve", help="Resolve audio URLs")
    aud_rs.add_argument("--ids", nargs="+", required=True)
    aud_rs.set_defaults(func=cmd_audio_resolve)

    # audio proxy
    aud_px = sub.add_parser("audio-proxy", help="Build proxy audio URL")
    aud_px.add_argument("audio_id")
    aud_px.add_argument("--title")
    aud_px.set_defaults(func=cmd_audio_proxy)

    # check-token
    sub.add_parser("check-token", help="Check if session token is valid").set_defaults(func=cmd_check_token)

    # rate-limit
    sub.add_parser("rate-limit", help="Show current rate limit status").set_defaults(func=cmd_rate_limit)

    # pending-export
    pe = sub.add_parser("pending-export", help="Check for pending export")
    pe.add_argument("project_id")
    pe.set_defaults(func=cmd_pending_export)

    # parse midjourney
    pm = sub.add_parser("parse-midjourney", help="Parse Midjourney params from a prompt")
    pm.add_argument("--prompt", required=True)
    pm.set_defaults(func=cmd_parse_midjourney)

    # validate prompt
    vp = sub.add_parser("validate-prompt", help="Validate prompt length")
    vp.add_argument("--prompt", required=True)
    vp.set_defaults(func=cmd_validate_prompt)

    return p


def main() -> None:
    p = build_parser()
    args = p.parse_args()
    # Some commands don't need a cookie (offline utilities)
    offline_commands = {"parse-midjourney", "validate-prompt"}
    if args.cmd in offline_commands:
        client = None  # type: ignore
    else:
        client = _client(args)
    try:
        args.func(client, args)
    except VibesAPIError as e:
        sys.exit(f"API error: {e}")
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
