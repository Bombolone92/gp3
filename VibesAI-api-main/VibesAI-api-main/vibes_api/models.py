"""
Enums and constants for the Vibes API client.

All values are taken directly from the vibes.ai Next.js bundles.
"""

from enum import Enum


class AspectRatio(str, Enum):
    """Supported aspect ratios for image / video generation.

    Only three ratios are actually supported by the server (verified live):
    1:1, 9:16, and 16:9. Other values will be rejected with
    ``GENERATION_FAILED``.
    """

    SQUARE = "1:1"       # 1280x1280 for images
    PORTRAIT = "9:16"    # 720x1280 (default in UI)
    LANDSCAPE = "16:9"   # 1280x720


class Resolution(str, Enum):
    """Supported output resolutions (shown under "Advanced" in the UI)."""

    P480 = "480p"
    P720 = "720p"


class VideoModel(str, Enum):
    """Available video generation models.

    Selecting the right model is important — different generation types
    require different models:

    - ``midjen-short``  → text-to-video (t2v) and image-to-video (i2v)
    - ``midjen-extend`` → video extension (auto/manual extend)
    - ``midjen-video-edit`` → video-to-video editing (v2v)
    - ``lipsync`` family → lip-sync generation
    """

    SHORT = "midjen-short"
    EXTEND = "midjen-extend"
    VIDEO_EDIT = "midjen-video-edit"
    LIPSYNC = "lipsync"
    LIPSYNC_ASYNC = "midjen-lipsync-async"
    LIPSYNC_EXP = "midjen-lipsync-exp"
    LIPSYNC_DIRECT = "midjen-lipsync-direct"


class ImageModel(str, Enum):
    """Available image generation models."""

    BASE = "midjen-base"


class PromptModel(str, Enum):
    """LLM used for prompt enhancement / parsing."""

    GEMINI_FLASH = "gemini-2.5-flash"


class GenerationType(str, Enum):
    """Generation type discriminator (sent in the ``config.generationType`` field).

    The server uses this to route the request to the correct pipeline:

    - ``t2v``  → text-to-video
    - ``t2i``  → text-to-image
    - ``i2v``  → image-to-video (start frame uploaded or selected)
    - ``extend`` → extend an existing video clip (auto or manual)
    - ``v2v``  → video-to-video editing
    - ``lipsync`` → lip-sync generation
    """

    TEXT_TO_VIDEO = "t2v"
    TEXT_TO_IMAGE = "t2i"
    IMAGE_TO_VIDEO = "i2v"
    EXTEND = "extend"
    VIDEO_TO_VIDEO = "v2v"
    LIPSYNC = "lipsync"


class IngredientType(str, Enum):
    """Type of studio ingredient.

    The three types map to UI sections in the Ingredients panel:
    Characters, Styles, Scenes (internally "SETTING").
    """

    CHARACTER = "CHARACTER"
    STYLE = "STYLE"
    SETTING = "SETTING"  # "Scene" in the UI


class OwnerFilter(str, Enum):
    """Filter for /api/studio/ingredients."""

    LIBRARY = "LIBRARY"  # User's saved ingredients
    VIEWER = "VIEWER"    # Ingredients visible to current viewer


class VoicePreset(str, Enum):
    """Built-in TTS voices.

    41 voices are available — these are the most common. Use
    ``client.list_voices()`` to get the full up-to-date list.
    """

    MARISOL = "play_ai_Marisol"
    GEORGE_WASHINGTON = "play_ai_1P_George_Washington"
    ABRAHAM_LINCOLN = "play_ai_1P_Abraham_Lincoln"
    JANE_AUSTEN = "play_ai_1P_Jane_Austen"
    SERAPHINE = "play_ai_1P_Seraphine"
    CELESTE = "play_ai_Celeste"
    NIGEL = "play_ai_Nigel"
    CONOR = "play_ai_Conor"


class TextOverlayPreset(str, Enum):
    """Effect presets for text overlays on the timeline."""

    FADE = "fade"
    SLIDE_UP = "slide-up"
    SURROUND = "surround"
    STRANGE = "strange"
    FLASH = "flash"
    SLIDE = "slide"
    CINEFADE = "cinefade"
    GLOW = "glow"
    TYPEWRITER = "typewriter"
    HIGHLIGHT = "highlight"
    GLITCH = "glitch"


class TextOverlayPosition(str, Enum):
    """Position presets for text overlays on the timeline."""

    CENTER = "center"
    TOP = "top"
    BOTTOM = "bottom"
    LEFT = "left"
    RIGHT = "right"
    TOP_LEFT = "top-left"
    TOP_RIGHT = "top-right"
    BOTTOM_LEFT = "bottom-left"
    BOTTOM_RIGHT = "bottom-right"


class SyncMode(str, Enum):
    """Modes used by the /api/sync endpoint (server-sent events).

    The UI uses these to coordinate real-time collaboration. ``polling``
    falls back to GET requests; ``sse`` opens an EventSource stream.
    """

    POLLING = "polling"
    SSE = "sse"


class EntityType(str, Enum):
    """Entity types accepted by /api/share-links, /api/sync, /api/collaborators."""

    PROJECT = "project"
    CONTENT_ITEM = "content-item"
