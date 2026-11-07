import { createAttentionUI } from "./attention-ui.js";
import {
  PRECISE_SELECTION_KEY,
  readPreciseSelection,
  createMarqueeIndex,
  marqueeSelection,
} from "./marquee.js";
import {
  DIMENSIONS_STORAGE_KEY,
  readDimensions,
  createDimensionIndex,
  dimensionBadge,
  dimensionBounds,
} from "./dimensions.js";
import {
  GRID_STORAGE_KEY,
  readGrid,
  gridSettings as normalizeGrid,
  gridStep,
  snapGridPoint,
  snapGridMove,
} from "./grid.js";
import { createTimerUI } from "./timer-ui.js";
import { createFacilitationUI } from "./facilitation/ui.js";
import { portableWorkshop, adoptWorkshop } from "./facilitation/model.js";
import "./facilitation/facilitation.css";
import { timerRemaining } from "./timer.js";
import { clearTagLayouts } from "./tag-renderer.js";
import { tagFooter } from "./tags.js";
import { createTagsUI, taggable } from "./tags-ui.js";
import { autoLayoutMindMaps, preserveManualMindMoves } from "./mind-map.js";
import { createMindMapUI } from "./mind-map-ui.js";
import { createMindMapHandles } from "./mind-map-handles.js";
import { createMindView } from "./mind-view.js";
import { createMindCollapse } from "./mind-collapse.js";
import {
  createMindDrag,
  validMindDrag,
  mindDragCandidate,
  planMindReparent,
} from "./mind-map-drag.js";
import { textLinkURL } from "./text-link-data.js";
import { objectAddress, boardDestination } from "./object-link-data.js";
import { createObjectLinks } from "./object-links.js";
import { createTableEditor } from "./table-editor.js";
import { tableCellAt } from "./table-cells.js";
import { tableHeight } from "./bulk-content.js";
import { tableLanguagePatch } from "./table-language.js";
import { sizedTableCells } from "./table-sizing.js";
import { createCommentsUI } from "./comments-ui.js";
import { objectRelationships } from "./accessibility/object-relationships.js";
import { validateComments, updateCommentAnchors } from "./comments.js";
import {
  planDuplication,
  placeDuplicates,
  checkDuplicateGeometry,
} from "./duplication.js";
import { FONT_FAMILIES, fontFamily, validFontFamily } from "./fonts.js";
import "./font-assets.js";
import {
  STYLE_STORAGE_KEY,
  copyObjectStyle,
  readObjectStyle,
  canCopyStyle,
  canPasteStyle,
  objectStylePatch,
  applyObjectStyle,
} from "./object-style.js";
import { createTextLinkPreview, textLinkHit } from "./text-links.js";
import {
  formatTextBlocks,
  indentTextBlocks,
  textParagraphs,
  spliceTextBlocks,
} from "./text-blocks.js";
import { createTextEditor } from "./text-editor.js";
import {
  TEXT_STYLE_KEYS,
  equalTextRuns,
  formatTextRuns,
  replaceTextRuns,
  textSegments,
  textDifference,
} from "./rich-text.js";
import { commandEntries, addCommands } from "./commands.js";
import { createCommandPalette } from "./command-palette.js";
import { createBoardSearch } from "./board-search.js";
import { createImageCropUI } from "./image-crop-ui.js";
import { createImageReplacement } from "./image-replace-ui.js";
import { createMinimap } from "./minimap-ui.js";
import { createCanvasNavigation } from "./navigation.js";
import { createResizePlan, resizeLimits, applyResize } from "./resize.js";
import {
  rotationOf,
  worldPoint,
  rotatePoint,
  setObjectHeight,
} from "./geometry.js";
import {
  rotationBox,
  rotationHit,
  createRotationPlan,
  rotationDelta,
  applyRotation,
  rotationSignature,
} from "./rotation.js";
import { createSnapIndex, snapMove, snapResize } from "./snapping.js";
import { hasLocked as objectLocked, setLocked } from "./locking.js";
import {
  createIcons,
  Bold,
  Italic,
  Link,
  Underline,
  Strikethrough,
  SlidersHorizontal,
  Scaling,
  RotateCw,
  Check,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUpRight,
  BringToFront,
  Circle,
  CircleHelp,
  Command,
  Cloud,
  CloudUpload,
  Columns3,
  Copy,
  CopyCheck,
  PaintRoller,
  Crop,
  Download,
  Ellipsis,
  Eraser,
  EyeOff,
  FileJson,
  ListFilter,
  Hand,
  Image,
  ImagePlus,
  Layers,
  LayoutDashboard,
  Lightbulb,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  LockKeyhole,
  Unlock,
  Maximize,
  MessageSquare,
  Magnet,
  Map as MapIcon,
  Minus,
  MousePointer2,
  MoveUpRight,
  Network,
  GitBranchPlus,
  GitPullRequestArrow,
  ListPlus,
  Pencil,
  PencilRuler,
  Plus,
  Presentation,
  Redo2,
  Scan,
  Search,
  Shapes,
  SmilePlus,
  Sparkles,
  Square,
  Star,
  StickyNote,
  Tags,
  Timer,
  Group,
  SunMoon,
  Trash2,
  Type,
  Undo2,
  Upload,
  UserRound,
  Users,
  Vote,
  X,
} from "lucide";
const icons = {
  ...EXTRA_ICONS,
  ListFilter,
  Bold,
  Italic,
  Link,
  Underline,
  Strikethrough,
  SlidersHorizontal,
  Scaling,
  RotateCw,
  Check,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUpRight,
  BringToFront,
  Circle,
  CircleHelp,
  Command,
  Cloud,
  CloudUpload,
  Columns3,
  Copy,
  CopyCheck,
  PaintRoller,
  Crop,
  Download,
  Ellipsis,
  Eraser,
  EyeOff,
  FileJson,
  Hand,
  Image,
  ImagePlus,
  Layers,
  LayoutDashboard,
  Lightbulb,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  LockKeyhole,
  Unlock,
  Maximize,
  MessageSquare,
  Magnet,
  Map: MapIcon,
  Minus,
  MousePointer2,
  MoveUpRight,
  Network,
  GitBranchPlus,
  GitPullRequestArrow,
  ListPlus,
  Pencil,
  PencilRuler,
  Plus,
  Presentation,
  Redo2,
  Scan,
  Search,
  Shapes,
  SmilePlus,
  Sparkles,
  Square,
  Star,
  StickyNote,
  Tags,
  Timer,
  Group,
  SunMoon,
  Trash2,
  Type,
  Undo2,
  Upload,
  UserRound,
  Users,
  Vote,
  X,
};
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-400-italic.css";
import "@fontsource/dm-sans/latin-600-italic.css";
import {
  connectorEndpointHit,
  setConnectorEnd,
  connectorLabel,
  clearConnectorLabelCache,
} from "./connectors.js";
import {
  canEditText,
  textStyle,
  shapeTextLayout,
  canAutoFitText,
  fitTextLayout,
  clearTextLayoutCache,
  growsWithText,
  autoHeightLayout,
  reflowTextItems,
} from "./text.js";
import { CUSTOM_SHAPES, canSwitchShape, shapeDefaults } from "./shapes.js";
import { canQuickConnect, quickConnectPlan } from "./quick-connect.js";
import { createQuickConnectUI } from "./quick-connect-ui.js";
import {
  board,
  item,
  uid,
  clone,
  escape,
  COLORS,
  History,
  bounds,
  zoomAt,
  validateBoard,
  extendDrawing,
  assertImagePixels,
  hitTest,
  selectedAt,
  resizeHit,
  resizeBounds,
} from "./model.js";
import { local, CloudStore } from "./storage.js";
import { CollaborationSession } from "./collaboration/session.js";
import { SharedDocument, rebase } from "./collaboration/document.js";
import {
  canManage,
  encode,
  parseLink,
  shareLink,
} from "./collaboration/protocol.js";
import {
  call as collaborationCall,
  deploy,
  refreshDeployment,
} from "./collaboration/api.js";
import {
  createOrganization,
  readOrganizationLink,
} from "./organization/client.js";
import "./organization/admin-strings.js";
import "./worker-strings.js";
import { createOrganizationHome } from "./organization/home-ui.js";
import { createOrganizationLibrary } from "./organization/library-ui.js";
import {
  createBoardAccess,
  assignableRoles,
  sectionLink,
  ROLE_LABELS,
} from "./organization/board-access.js";
import "./organization/organization.css";
import { EXTRA_ICONS } from "./extra-icons.js";
import { createAI } from "./ai/ai-ui.js";
import { createOnboarding } from "./help/onboarding.js";
import { createHelpCenter } from "./help/help-center.js";
import { createAltText } from "./accessibility/alt-text.js";
import { canonicalLanguage } from "./accessibility/language-tag.js";
import {
  authoredTextHTML,
  objectNameHTML,
  languageAttribute,
} from "./accessibility/object-content.js";
import { createPlanning } from "./planning/index.js";
import "./planning/planning.css";
import {
  PresenceLayer,
  color as participantColor,
} from "./collaboration/presence.js";
import { bindText } from "./collaboration/text-binding.js";
import { paint, paintPreviews, exportPNG, preview } from "./render.js";
import "./style.css";
import {
  descendants,
  selectionGroupId,
  isConnector,
  unlockedSelection,
  inferParents,
  inferMovedParents,
  updateConnectors,
  removeItems,
  moveItems,
  reorderItems,
  group,
  ungroup,
} from "./scene.js";
import { fromTemplate } from "./templates.js";
import {
  language,
  setLanguage,
  t,
  translateUI,
  objectName,
  editTitle,
} from "./i18n.js";
import { createFeatures } from "./features.js";
import { createTransfer, textObject, decodeImage } from "./transfer.js";
import { createBulkContent } from "./bulk-content.js";
import { createImageClipboard } from "./image-clipboard.js";
import { createContentTools } from "./content/content.js";
import { loadPdfjs } from "./content/pdf-loader.js";
import { busy } from "./accessibility/busy.js";
import "./content/content.css";
import {
  canClearContent,
  hasClearableContent,
  clearContent,
} from "./clear-content.js";
const app = document.querySelector("#app");
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const button = (name, label, action, extra = "") =>
  `<button class="icon-btn" aria-label="${label}" title="${label}" data-action="${action}" ${extra}>${icon(name)}</button>`;
const brandImage = `<img src="/icons/icon-64.png" srcset="/icons/icon-128.png 2x" width="33" height="33" alt="" draggable="false">`;
const logo = `<span class="brand-mark">${brandImage}</span><span>whiteboard<span class="brand-dot">.</span></span>`;
let boards = [],
  current = null,
  history = new History(),
  selection = new Set(),
  selectionAnchor = null,
  focusedGroup = null,
  tool = "select",
  view = { x: 90, y: 75, z: 1 },
  filter = "all",
  search = "",
  librarySort = "recent",
  cloud = null,
  cloudIds = new Set(),
  pendingCloud = new Map(),
  cloudTimer,
  saveChain = Promise.resolve(),
  space = false,
  drag = null,
  lastTap = null,
  theme = "system",
  characterShortcuts = true,
  snapping = true,
  boardGrid = readGrid(null),
  showDimensions = false,
  preciseSelection = false,
  exportRegion = null,
  editing = null;
let hoveredMind = null;
// The last arrow-key move, which a held key continues.
let nudge = null;
// Until when others keep showing this person's last live preview: a
// finished change reaches them after the presence saying it ended.
let presenceSettling = 0;
const mindView = createMindView({
  board: () => current,
  readOnly: isSharedReadOnly,
  editing: () => editing?.item.id,
  persist: (fn) => mutate(fn, { mindLayout: true }),
  redraw: () => {
    minimap.invalidate();
    draw();
  },
});
// Staged frames and private notes stay hidden in every view of the board.
const visibleItems = () => facilitation.visible(mindView.scene().visible);
const visualBoard = () =>
  current && facilitation.masked({ ...current, items: mindView.scene().items });
let copiedStyle = null;
try {
  copiedStyle = readObjectStyle(localStorage.getItem(STYLE_STORAGE_KEY));
} catch {}
// Shared boards left with edits not yet sent, by room.
const unsentBoards = new Map();
// Where each shared board's session keeps its rows on this device.
const collaborationScopes = new WeakMap();
let collaboration = null,
  // Counts connection attempts, so an earlier one still connecting, as
  // after reopening the board meanwhile, stops instead of running as well.
  collaborationAttempt = 0,
  collaborationBusy = false,
  collaborationRendered = null,
  collaborationLastSaved = null,
  collaborationEdits = Promise.resolve(),
  presenceLayer = null,
  // The selection and edited object last sent to the others.
  presenceSelection = "",
  // Collaborators' live preview of each object, reused between draws.
  previewCopies = new WeakMap(),
  collaborationPeople = new Map(),
  collaborationRoster = [],
  collaborationCursor = null,
  collaborationPendingEdits = 0,
  collaborationFrame = null,
  collaborationHadPreview = false;
const attention = createAttentionUI({
  session: () => collaboration,
  canBring: () => !facilitation.boardLocked(),
  view: () => view,
  size: () => {
    const r = document.querySelector("#canvas")?.getBoundingClientRect();
    return { width: r?.width || 800, height: r?.height || 600 };
  },
  busy: () =>
    !!(
      editing ||
      drag ||
      imageCrop.id() ||
      tableEditor.isOpen() ||
      document.querySelector("dialog[open]") ||
      document.activeElement?.closest("input,textarea,select,[contenteditable]")
    ),
  prepare: () => {
    canvasNavigation.finish();
    pointerUp();
    finishTextEdit();
  },
  navigate: (next) => {
    view = next;
    draw();
  },
  focusCanvas: () => document.querySelector("#canvas")?.focus(),
  redrawCursors: () => draw(),
  toast,
});
const workshopTimer = createTimerUI({
  board: () => current,
  now: () => collaboration?.now() ?? Date.now(),
  // Participants of a locked board follow the facilitator's timer.
  canEdit: () =>
    !!current && !isSharedReadOnly() && !facilitation.boardLocked(),
  ready: () => !collaborationBusy,
  save: (timer) => {
    if (!current || isSharedReadOnly()) return;
    current.timer = timer;
    save();
  },
  toast,
});
const facilitation = createFacilitationUI({
  board: () => current,
  editing: () => !!editing,
  identity: () =>
    collaboration
      ? {
          id: collaboration.user.uuid,
          name: collaboration.user.username || "Member",
        }
      : { id: commentIdentity, name: "Local author" },
  role: () => collaboration?.role || "owner",
  canParticipate: () => !!current && !isCommentReadOnly(),
  canEdit: () => !!current && !isSharedReadOnly(),
  now: () => collaboration?.now() ?? Date.now(),
  view: () => view,
  canvas: () => document.querySelector("#canvas"),
  hidden: () => mindView.scene().hidden,
  selection: () => selection,
  select: (ids) => {
    setTool("select");
    selectItems(ids);
    draw();
  },
  commit: (workshop) => {
    if (!current || isCommentReadOnly())
      return toast("This board is read-only.");
    if (workshop) current.workshop = workshop;
    else delete current.workshop;
    save();
    draw();
  },
  setTimer: (timer) => {
    if (!current || isSharedReadOnly()) return;
    current.timer = timer;
    save();
    draw();
  },
  focusFrame: (frame) => focusRegion(bounds([frame])),
  bring: () => collaboration && attention.bring("all"),
  follow: (session) => collaboration && attention.bring(session),
  session: () => collaboration,
  roster: () => collaborationRoster,
  prepare: () => {
    objectLinks.close();
    comments.close(false);
    boardSearch.close(false);
    tags.close();
    planning.close();
  },
  refreshIcons: () => iconsRefresh(),
  // A change the workshop refused was undone; show the board as saved.
  draw: () => {
    const title = document.querySelector("#board-title");
    if (current && title) {
      title.value = current.title;
      document.title = current.title + " · Whiteboard";
    }
    draw();
  },
  icon,
  toast,
  download,
});
const features = createFeatures({
  board: () => current,
  visualBoard,
  objectURL: (id, target = current) => objectAddress(target, id, location.href),
  selection: () => selection,
  selectionOptions,
  focusedGroup: () => focusedGroup,
  select: selectItems,
  region: () => exportRegion,
  exactRegion: exactRegionDialog,
  canEdit: canEditSelection,
  unlockAll,
  copyImage: () => imageClipboard.copy(),
  copyStyle,
  pasteStyle,
  clearContent: clearSelectionContent,
  moveSelection: moveSelectionDialog,
  replaceImage: () => imageReplacement.open(),
  bulkNotes: () => bulkContent.open(),
  commands: () => commandPalette.open(),
  mindMap: () => mindMap.create(),
  minimap: () => minimap.toggle(),
  timer: () => workshopTimer.open(),
  facilitation: () => facilitation.toggle(),
  portable: (exported) => facilitation.portable(exported),
  portableCopy: (copy) => facilitation.portableCopy(copy),
  concealedIn: (b) => facilitation.concealedIn(b),
  presentTimer: (dialog) => workshopTimer.present(dialog),
  presentAttention: (dialog, rect) => attention.present(dialog, rect),
  navigation: () => navigationSettings(),
  grid: () => openGridSettings(),
  dimensions: () => openDimensionSettings(),
  selectionSettings: () => openSelectionSettings(),
  placeItems: gridPlaceItems,
  addShape,
  mutate,
  draw,
  save,
  modal,
  toast,
  download,
  center,
  viewCenter,
  fileInput,
  local,
  help,
  setTool,
  focusRegion,
  focusClusters: (box) => focusRegion(box, undefined, true),
  waitForSaves: () => saveChain,
  refresh: iconsRefresh,
  // Shared boards record exports in the organization's audit log.
  exported: (format, scope) =>
    collaboration?.request("export", { format, scope }).catch(() => {}),
  sharedHistory: () =>
    collaboration && {
      list: (before) =>
        collaboration.request(
          "history.list",
          before === undefined ? {} : { before },
        ),
      load: (at) => collaboration.versionBoard(at),
      note: (details) =>
        collaboration.request("history.restored", details).catch(() => {}),
    },
  replaceItems: (items) =>
    mutate(() => {
      current.items = validateBoard({ ...current, items }).items;
      selection.clear();
    }),
  restore: (b) => {
    // Throw so the caller cannot report a restoration that did not happen.
    if (isSharedReadOnly()) throw Error("This board is read-only.");
    current.title = b.title;
    current.items = validateBoard(b).items;
    current.tags = b.tags && clone(b.tags);
    history = new History();
    selection.clear();
    updateConnectors(current.items);
    editor();
    fit();
    save();
  },
  addBoard: async (b) => {
    boards.push(b);
    await local.save(b);
    openBoard(b);
  },
});
const transfer = createTransfer({
  board: () => current,
  objectURL: (id, target = current) => objectAddress(target, id, location.href),
  selection: () => selection,
  selectionOptions,
  select: selectItems,
  mutate,
  toast,
  center,
  pastePoint: (box) => {
    const c = viewCenter();
    return { x: c.x - box.w / 2, y: c.y - box.h / 2 };
  },
  point: canvasPoint,
  placeItems: gridPlaceItems,
  finishEditing: finishTextEdit,
  canAdd: () => canEditSelection(new Set()),
  canDrop: () => !isSharedReadOnly(),
  canCut: (ids) => canEditSelection(ids, { deleting: true }),
  concealed: () => facilitation.concealedIds(),
  pasteCells: (...args) => bulkContent.open(...args),
  receiveText: (...args) => contentTools.receiveText(...args),
  receiveFiles: (...args) => contentTools.receiveFiles(...args),
});
const bulkContent = createBulkContent({
  board: () => current,
  center,
  modal,
  canAdd: () => canEditSelection(new Set()),
  insert: (...args) => transfer.insert(...args),
  textObject,
});
// Embeds, Google Workspace imports, and document import (src/content/).
const contentTools = createContentTools({
  board: () => current,
  selection: () => selection,
  view: () => view,
  readOnly: isSharedReadOnly,
  busy: () =>
    !!(
      editing ||
      drag ||
      imageCrop.id() ||
      tableEditor.isOpen() ||
      exportRegion
    ),
  // Collapsed mind-map branches and workshop content hidden from this
  // person never show live.
  hidden: (id) =>
    mindView.scene().hidden.has(id) || facilitation.concealedIds().has(id),
  canAdd: () => canEditSelection(new Set()),
  canEdit: canEditSelection,
  allows: (feature) => organization.allows(feature),
  insert: (...args) => transfer.insert(...args),
  measure: () => document.createElement("canvas").getContext("2d"),
  focus: (frames) => frames.length && focusRegion(bounds(frames)),
  action: (name) => action(name),
  loadPdfjs,
  // Images whose size is not in their first bytes are measured by the
  // browser.
  decodeImage,
  mutate,
  toast,
  modal,
  center,
  fileInput,
});
Object.assign(features.actions, contentTools.actions);
const imageClipboard = createImageClipboard({
  board: () => current,
  visualBoard,
  selection: () => selection,
  selectionOptions,
  modal,
  toast,
  download,
});
const boardSearch = createBoardSearch({
  board: () => facilitation.masked(current),
  draw,
  select: (ids) => {
    setTool("select");
    selectItems(ids);
  },
  icon,
  reveal: (id) => mindView.reveal(id),
  focus: (box, panel) => focusRegion(box, panel),
});
const tags = createTagsUI({
  board: () => current,
  selection: () => selection,
  canvas: () => document.querySelector("#canvas"),
  canEdit: (ids) =>
    !!current && !isSharedReadOnly() && !hasLocked(current.items, ids),
  concealed: () => facilitation.concealedIds(),
  mutate,
  draw,
  toast,
  prepare: () => {
    finishTextEdit();
    tableEditor.close();
    objectLinks.close();
    comments.close(false);
    boardSearch.close(false);
    imageCrop.close(false);
    imageReplacement.close();
  },
  find: (tagId) => boardSearch.open({ tagId }),
});
let commentIdentity,
  boardMembers = [];
try {
  commentIdentity = localStorage.getItem("whiteboard-comment-author");
} catch {}
if (!commentIdentity || !/^device:[\da-f-]{36}$/.test(commentIdentity)) {
  commentIdentity = `device:${uid()}`;
  try {
    localStorage.setItem("whiteboard-comment-author", commentIdentity);
  } catch {}
}
const comments = createCommentsUI({
  state: () => ({
    board: current,
    view,
    selection,
    // Pins on hidden content would show where it is.
    hidden: hiddenFromView(),
    concealed: facilitation.concealedIds(),
    readOnly: isCommentReadOnly(),
    author: collaboration
      ? {
          id: collaboration.user.uuid,
          name: collaboration.user.username || "Member",
        }
      : { id: commentIdentity, name: "Local author" },
  }),
  canvas: () => document.querySelector("#canvas"),
  now: () => collaboration?.now() ?? Date.now(),
  icon,
  draw,
  toast,
  prepare: () => {
    refreshBoardMembers();
    objectLinks.close();
    facilitation.close(false);
    canvasNavigation.finish();
    pointerUp();
    finishTextEdit();
    boardSearch.close(false);
    imageCrop.close(false);
    imageReplacement.close();
    // The task panel sits where the comments panel opens.
    planning.close();
  },
  add: () => addComment(),
  // Board members and people present can be mentioned with @name.
  people: () =>
    [
      ...boardMembers
        .filter((m) => m.role !== "removed" && !m.inactive)
        .map((m) => ({ id: m.uuid, name: m.username })),
      ...collaborationRoster.map((p) => ({ id: p.user, name: p.username })),
    ].filter((p) => p.id !== collaboration?.user?.uuid),
  reactions: (thread, message) =>
    facilitation.commentReactions(thread, message),
  anchor: (p) => hitTest(visibleItems(), p, 8 / view.z),
  reveal: (id) => mindView.reveal(id),
  focus: (p, panel) => {
    // Opening a discussion moves the view, so it stops following, as other
    // panel navigation does; otherwise the leader's next move undoes it.
    attention.stop();
    const r = document.querySelector("#canvas").getBoundingClientRect();
    const width =
      r.width > 760
        ? Math.max(160, r.width - panel.getBoundingClientRect().width - 32)
        : r.width;
    view.x = width / 2 - p.x * view.z;
    view.y = r.height / 2 - p.y * view.z;
    draw();
  },
  save: (value) => {
    if (isCommentReadOnly()) return toast("This board is read-only.");
    validateComments(value);
    current.comments = value;
    save();
    draw();
  },
});
const organization = createOrganization({
  puter: () => window.puter,
  call: collaborationCall,
  deploy,
});
// The Miro migration and the administration console load when first opened.
// A failed load is retried the next time.
function lazily(load) {
  let pending;
  return () =>
    (pending ??= load().catch(() => {
      pending = null;
      throw Error(
        t("This feature could not load. Check your connection and try again."),
      );
    }));
}
const migrationHost = lazily(() =>
  import("./migration/host.js").then(({ createMigrationHost }) =>
    createMigrationHost(migrationOptions),
  ),
);
const migration = { open: async () => (await migrationHost()).open() };
const migrationOptions = {
  org: organization,
  puter: () => window.puter,
  modal,
  toast,
  download,
  addLocalBoard: async (b) => {
    boards.push(b);
    await local.save(b);
    refreshLibrary();
  },
  device: () => commentIdentity.slice("device:".length),
  removeLocalBoard: async (id) => {
    const b = boards.find((x) => x.id === id);
    if (!b) return;
    b.deletedAt = Date.now();
    await local.save(b);
    refreshLibrary();
  },
};
async function openMigration() {
  try {
    await connect();
    if (!organization.allows("miro"))
      return toast("Your organization has turned off Miro imports.");
    await migration.open();
  } catch (error) {
    toast(error.message || "Could not connect to Puter.");
  }
}
const adminLoader = lazily(() =>
  import("./organization/admin-ui.js").then(({ createAdminConsole }) =>
    createAdminConsole({
      org: organization,
      migrate: openMigration,
      modal,
      toast,
      icon,
      download,
      refresh: iconsRefresh,
      openBoard: (room) => openShared(organization.server, room),
    }),
  ),
);
const adminConsole = {
  open: (tab) =>
    adminLoader().then(
      (admin) => admin.open(tab),
      (error) => toast(error.message),
    ),
};
const organizationLibrary = createOrganizationLibrary({
  org: organization,
  modal,
  toast,
  icon,
  refresh: iconsRefresh,
  // A template from the library becomes a new board on this device.
  useBoard: async (json, name) => {
    const b = validateBoard(JSON.parse(json));
    assertImagePixels(b.items);
    b.id = uid();
    for (const key of ["shared", "timer", "deletedAt", "comments"])
      delete b[key];
    b.workshop = portableWorkshop(b.workshop);
    if (!b.workshop) delete b.workshop;
    b.favorite = false;
    b.updated = Date.now();
    b.title = (name || b.title).slice(0, 200);
    boards.push(b);
    await local.save(b);
    await openBoard(b);
  },
  // The open board as this person may see it, without its discussion.
  shareable: () => {
    if (!current) return null;
    const copy = clone(current);
    facilitation.portableCopy(copy);
    for (const key of ["shared", "timer", "comments", "favorite", "deletedAt"])
      delete copy[key];
    copy.id = uid();
    return copy;
  },
});
addCommands(({ add }) => {
  if (!organization.isMember) return;
  add(
    "org-library",
    "Organization library",
    "Board",
    "organization library templates bibliotheque organisation modeles",
  );
  add(
    "org-library-share",
    "Share to organization library",
    "Board",
    "share template library publish partager modele bibliotheque",
  );
});
const organizationHome = createOrganizationHome({
  org: organization,
  modal,
  toast,
  icon,
  refresh: iconsRefresh,
  openShared,
  admin: adminConsole,
  library: () => organizationLibrary.open(),
  connect: () => connect(),
  rerender: () => {
    if (!current) home();
  },
});
const boardAccess = createBoardAccess({
  org: organization,
  session: () => collaboration,
  // Section links list only frames this person may see.
  board: () => facilitation.masked(current),
  modal,
  toast,
  icon,
  refresh: iconsRefresh,
  home: () => home(),
});
const ai = createAI({
  org: organization,
  session: () => collaboration,
  board: () => current,
  view: () => facilitation.masked(current),
  selection: () => selection,
  modal,
  toast,
  icon,
  mutate,
  center,
  select: (ids) => {
    selectItems(ids);
    draw();
  },
  canEdit: canEditSelection,
  fileInput,
  refresh: iconsRefresh,
  signIn: () => connect(),
});
const altText = createAltText({
  board: () => current,
  modal,
  mutate,
  toast,
  ai,
  canEdit: canEditSelection,
});
const onboarding = createOnboarding({
  focusCanvas: () => document.querySelector("#canvas")?.focus(),
});
const helpCenter = createHelpCenter({
  modal,
  icon,
  refresh: iconsRefresh,
  tour: () => startTour(),
  shortcuts: () => help(),
  org: organization,
  toast,
});
function startTour() {
  document.querySelector("#tour-offer")?.remove();
  if (current) onboarding.start();
  else toast("Open a board to take the tour.");
}
const planning = createPlanning({
  board: () => current,
  view: () => facilitation.masked(current),
  concealed: () => facilitation.concealedIds(),
  locked: (ids) => hasLocked(current.items, ids),
  // Why a facilitator's lock keeps this person from changing the board's
  // plan and adding objects other than sticky notes, or null.
  boardLocked: () =>
    facilitation.frozen() ||
    (facilitation.boardLocked() ? "The facilitator locked this board." : null),
  selection: () => selection,
  select: (ids) => {
    setTool("select");
    selectItems(ids);
    draw();
  },
  canvas: () => document.querySelector("#canvas"),
  readOnly: isSharedReadOnly,
  session: () => collaboration,
  org: organization,
  now: () => collaboration?.now() ?? Date.now(),
  prepare: () => {
    finishTextEdit();
    tags.close();
    tableEditor.close();
    objectLinks.close();
    comments.close(false);
    boardSearch.close(false);
    // Side panels share the right edge; one opening closes the other.
    facilitation.close(false);
  },
  addObject,
  mutate,
  focusRegion: (box) => focusRegion(box, undefined, true),
  modal,
  toast,
  download,
});
addCommands(({ board: b, selection: chosen, add }) => {
  if (!b || !chosen.size || !facilitation.canHide()) return;
  const shown = [...chosen].every((id) => facilitation.hidden(id));
  add(
    shown ? "show-objects" : "hide-objects",
    shown ? "Show to participants" : "Hide from participants",
    "Workshop",
    "hide conceal hidden facilitator reveal masquer cacher afficher participants",
  );
});
function selectedLinkObject() {
  const id = selection.has(selectionAnchor)
    ? selectionAnchor
    : selection.size === 1
      ? [...selection][0]
      : null;
  return current?.items.find((i) => i.id === id);
}
const mindMap = createMindMapUI({
  board: () => current,
  source: () => (editing?.item?.mindMap ? editing.item : selectedLinkObject()),
  collapsed: (id) => !!mindView.scene().counts.has(id),
  toggle: (id) => toggleMindBranch(id),
  canEdit: canEditSelection,
  mutate: (fn) => mutate(fn, { mindLayout: true }),
  select: selectItems,
  finish: finishTextEdit,
  edit: beginTextEdit,
  center: () => snapGridPoint(center(), activeGridStep()),
  draw,
  modal,
  toast,
  focus: () =>
    document.querySelector("#canvas")?.focus({ preventScroll: true }),
  reveal: (i, overview = false) => {
    if (!i) return;
    const rect = document.querySelector("#canvas").getBoundingClientRect();
    if (!rect.width || !rect.height) {
      draw();
      return;
    }
    if (overview) {
      const top = Math.min(180, rect.height / 3),
        bottom = 100;
      const z = Math.max(
        0.15,
        Math.min(
          1.25,
          (rect.width - 140) / (i.w + 40),
          (rect.height - top - bottom) / (i.h + 40),
        ),
      );
      view = {
        x: rect.width / 2 - (i.x + i.w / 2) * z,
        y: top + (rect.height - top - bottom) / 2 - (i.y + i.h / 2) * z,
        z,
      };
      draw();
      return;
    }
    const z = Math.min(1.5, Math.max(0.8, view.z));
    const x = view.x + i.x * view.z,
      y = view.y + i.y * view.z;
    if (
      view.z < 0.8 ||
      x < 90 ||
      y < 160 ||
      x + i.w * view.z > rect.width - 90 ||
      y + i.h * view.z > rect.height - 90
    )
      view = {
        x: rect.width / 2 - (i.x + i.w / 2) * z,
        y: rect.height / 2 - (i.y + i.h / 2) * z,
        z,
      };
    draw();
  },
});
const tableEditor = createTableEditor({
  state: () => ({ board: current, view }),
  canvas: () => document.querySelector("#canvas"),
  selected: (i) => selectedLinkObject() === i,
  writable: (i) =>
    !!i && !isSharedReadOnly() && !hasLocked(current.items, new Set([i.id])),
  prepare: () => {
    canvasNavigation.finish();
    pointerUp();
    finishTextEdit();
    objectLinks.close();
    comments.close(false);
    boardSearch.close(false);
    imageCrop.close(false);
    imageReplacement.close();
  },
  resize: (i, patch) => {
    if (current.items.includes(i) && canEditSelection(new Set([i.id])))
      mutate(() => Object.assign(i, patch));
  },
  change: (i, cells, structure, languages) => {
    if (!current.items.includes(i) || !canEditSelection(new Set([i.id])))
      return;
    const languagePatch = tableLanguagePatch(i, cells, structure, languages);
    if (i.columnWidths || i.rowHeights) {
      const patch = sizedTableCells(
        i,
        cells,
        document.querySelector("#canvas").getContext("2d"),
        structure,
      );
      return mutate(() => Object.assign(i, patch, languagePatch));
    }
    const w = (i.w * cells[0].length) / i.cells[0].length;
    const h = Math.max(
      (i.h * cells.length) / i.cells.length,
      tableHeight(
        cells,
        w,
        document.querySelector("#canvas").getContext("2d"),
        i.fontSize || 15,
        fontFamily(i),
      ),
    );
    if (w > 1e6 || h > 1e6)
      throw Error("The table is too tall. Use a smaller font or fewer lines.");
    mutate(() => Object.assign(i, { w, h }, languagePatch));
  },
  reveal: (box, editing = false) => {
    const rect = document.querySelector("#canvas").getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (editing && view.z < 0.8)
      view = zoomAt(
        view,
        {
          x: view.x + (box.x + box.w / 2) * view.z,
          y: view.y + (box.y + box.h / 2) * view.z,
        },
        0.8,
      );
    const toolbar = document
      .querySelector(".table-cell-tools")
      ?.getBoundingClientRect();
    const left = Math.min(80, rect.width / 8),
      top = Math.min(
        Math.max(80, (toolbar?.bottom || rect.top) - rect.top + 16),
        rect.height - 140,
      ),
      right = rect.width - 30,
      bottom = rect.height - 90;
    const x = view.x + box.x * view.z,
      y = view.y + box.y * view.z;
    if (x < left) view.x += left - x;
    else if (x + box.w * view.z > right)
      view.x -= Math.min(x - left, x + box.w * view.z - right);
    if (y < top) view.y += top - y;
    else if (y + box.h * view.z > bottom)
      view.y -= Math.min(y - top, y + box.h * view.z - bottom);
    draw();
  },
  draw,
  toast,
});
// Collapsed mind map branches, and content the workshop hides from this
// person, such as others' private notes.
function hiddenFromView() {
  const collapsed = mindView.scene().hidden,
    concealed = facilitation.concealedIds();
  return concealed.size ? new Set([...collapsed, ...concealed]) : collapsed;
}
const objectLinks = createObjectLinks({
  state: () => ({
    board: current,
    view,
    hidden: hiddenFromView(),
    concealed: facilitation.concealedIds(),
  }),
  selected: selectedLinkObject,
  base: () => location.href,
  address: (id) => objectAddress(current, id, location.href),
  canvas: () => document.querySelector("#canvas"),
  writable: (i) =>
    !!i && !isSharedReadOnly() && !hasLocked(current.items, new Set([i.id])),
  prepare: () => {
    canvasNavigation.finish();
    pointerUp();
    finishTextEdit();
    comments.close(false);
    boardSearch.close(false);
    imageCrop.close(false);
    imageReplacement.close();
    textLinkPreview.close();
  },
  change: (i, link) => {
    if (!current.items.includes(i) || !canEditSelection(new Set([i.id])))
      return;
    mutate(() => {
      if (link) i.objectLink = link;
      else delete i.objectLink;
    });
  },
  navigate: focusLinkedObject,
  icon,
  draw,
  toast,
  modal,
});
function focusLinkedObject(id, updateAddress = true) {
  const i = current?.items.find((i) => i.id === id);
  // Content hidden from this person is treated as absent, not selected.
  if (!i || facilitation.absent(id))
    return toast("The linked object is no longer on this board.");
  canvasNavigation.finish();
  pointerUp();
  finishTextEdit();
  objectLinks.close();
  comments.close(false);
  boardSearch.close(false);
  imageCrop.close(false);
  imageReplacement.close();
  if (updateAddress) {
    window.history.replaceState(
      {
        whiteboard: {
          boardId: current.id,
          view: { ...view },
          selection: [...selection],
          anchor: selectionAnchor,
          focusedGroup,
        },
      },
      "",
      location.href,
    );
    window.history.pushState(
      null,
      "",
      objectAddress(current, id, location.href),
    );
  }
  selectItems(new Set([id]));
  focusRegion(bounds(visibleItems().filter((i) => selection.has(i.id))));
  document.querySelector("#canvas").focus({ preventScroll: true });
}
async function followBoardAddress(value) {
  const destination = boardDestination(value, location.href);
  if (!destination) return;
  const origin = current;
  if (origin) {
    pointerUp();
    finishTextEdit();
    clearTimeout(cloudTimer);
    if (cloudIds.has(origin.id)) await sync(clone(origin));
    await saveChain;
    if (current !== origin || location.href !== value) return;
  }
  // An invitation joins through the dialog, as it does when the page loads,
  // even for a board already on this device: it may be for another account,
  // or renew access that lapsed.
  if (destination.token) return joinDialog(value);
  let target = destination.localId
    ? boards.find((b) => b.id === destination.localId)
    : boards.find(
        (b) =>
          b.shared?.server === destination.server &&
          b.shared?.room === destination.room,
      );
  if (destination.localId && !target) {
    const saved = await local.list();
    target = saved.find((b) => b.id === destination.localId);
    if (target) boards.push(target);
  }
  if (location.href !== value) return;
  if (!target || target.deletedAt) {
    if (destination.localId || target?.deletedAt)
      return toast(
        "This board is unavailable on this device. Check your boards or Trash.",
      );
    return joinDialog(value);
  }
  if (current !== target) await openBoard(target, { keepAddress: true });
  if (current !== target || location.href !== value) return;
  if (destination.objectId) focusLinkedObject(destination.objectId, false);
  // An empty board opens at 100%, as it does from the board library.
  else if (current.items.length) fit();
}
function addComment() {
  const target =
    selection.size === 1
      ? current.items.find((i) => selection.has(i.id))
      : null;
  const p = target
    ? { x: target.x + target.w - 12, y: target.y + 12 }
    : center();
  comments.compose(p, target);
}
const minimap = createMinimap({
  state: () => ({
    board: current,
    view,
    narrowSearch:
      !!current &&
      document.querySelector("#canvas").getBoundingClientRect().width <= 760 &&
      (boardSearch.isOpen() || comments.isOpen()),
  }),
  canvas: () => document.querySelector("#canvas"),
  prepare: (opening = false) => {
    attention.stop();
    canvasNavigation.finish();
    minimap.cancel();
    pointerUp();
    finishTextEdit();
    if (
      opening &&
      document.querySelector("#canvas").getBoundingClientRect().width <= 760
    )
      boardSearch.close(false);
  },
  navigate: (next) => {
    attention.stop();
    view = next;
    draw();
  },
  fit,
  draw,
});
const textLinkPreview = createTextLinkPreview({
  state: () => ({
    board: current,
    editing,
    drag,
    view,
    concealed: facilitation.concealedIds(),
  }),
  canvas: () => document.querySelector("#canvas"),
  writable: (i) =>
    !isSharedReadOnly() && !hasLocked(current.items, new Set([i.id])),
  edit: (i, link) => {
    if (!current?.items.includes(i) || !canEditSelection(new Set([i.id])))
      return;
    beginTextEdit(i);
    editing.input.setSelectionRange(link.start, link.end);
    openTextLinkEditor();
  },
});
const canvasNavigation = createCanvasNavigation({
  state: () => ({ board: current, view, tool }),
  deferTap: () =>
    !space &&
    ["note", "text", "rect", "ellipse", "frame", "comment"].includes(tool),
  prepare: () => {
    attention.stop();
    comments.cancel();
    minimap.cancel();
    pointerUp();
    imageCrop.close(false);
    imageReplacement.close();
    boardSearch.close(false);
    document.querySelector("#canvas").focus({ preventScroll: true });
  },
  selection: () => ({
    ids: [...selection],
    anchor: selectionAnchor,
    focusedGroup,
  }),
  restoreSelection: (saved) => {
    const existing = new Set(current.items.map((i) => i.id));
    selection = new Set(saved.ids.filter((id) => existing.has(id)));
    selectionAnchor = selection.has(saved.anchor) ? saved.anchor : null;
    focusedGroup = saved.focusedGroup || null;
    draw();
  },
  touchEdit: (e) => {
    if (isSharedReadOnly() || hasLocked(current.items, selection)) return false;
    const p = canvasPoint(e);
    const hit = hitTest(visibleItems(), p, 8 / view.z);
    return (
      !!resizeHit(current.items, selection, p, view.z, selectionAnchor) ||
      rotationHit(current.items, selection, p, view.z, true) ||
      selection.has(hit?.id) ||
      // As with a mouse, an empty part of a selected object's box drags it.
      (!hit && !!selectedAt(visibleItems(), selection, p, 4 / view.z))
    );
  },
  canMarquee: () =>
    tool === "select" &&
    !space &&
    !editing &&
    !tableEditor.isOpen() &&
    !objectLinks.isOpen() &&
    (!drag ||
      (["move", "link", "marquee"].includes(drag.kind) &&
        !drag.active &&
        !drag.changed)),
  resetTap: () => {
    lastTap = null;
  },
  begin: pointerDown,
  move: pointerMove,
  hover: pointerMove,
  end: pointerUp,
  cancel: cancelTransform,
  navigate: (next) => {
    attention.stop();
    view = next;
    draw();
  },
});
const imageCrop = createImageCropUI({
  state: () => ({ board: current, view, snapping, selection }),
  canvas: () => document.querySelector("#canvas"),
  canEdit: (id) =>
    !!current &&
    !isSharedReadOnly() &&
    !hasLocked(current.items, new Set([id])),
  draw,
  toast,
  focus: (box) => {
    const r = document.querySelector("#canvas").getBoundingClientRect();
    const narrow = r.width <= 760,
      top = narrow ? 264 : 0;
    const width = Math.max(80, r.width - (narrow ? 0 : 322));
    const height = Math.max(80, r.height - top);
    view.z = Math.max(
      0.15,
      Math.min(2, (width - 48) / box.w, (height - 48) / box.h),
    );
    view.x = width / 2 - (box.x + box.w / 2) * view.z;
    view.y = top + height / 2 - (box.y + box.h / 2) * view.z;
    draw();
  },
  commit: (id, next) => {
    if (!canEditSelection(new Set([id]))) return;
    mutate(() => {
      const i = current.items.find((i) => i.id === id);
      Object.assign(i, next);
      if (!i.crop) delete i.crop;
    });
  },
  wheel: (e) => canvasNavigation.wheel(e),
});
const imageReplacement = createImageReplacement({
  board: () => current,
  selection: () => selection,
  concealed: () => facilitation.concealedIds(),
  readOnly: isSharedReadOnly,
  canEdit: (id) =>
    !!current &&
    !isSharedReadOnly() &&
    !hasLocked(current.items, new Set([id])),
  modal,
  fileInput,
  toast,
  commit: (id, next) => {
    if (!canEditSelection(new Set([id]))) return;
    mutate(() =>
      Object.assign(
        current.items.find((i) => i.id === id),
        next,
      ),
    );
  },
});
const commandPalette = createCommandPalette({
  context: () => current,
  version: () => [
    current,
    current?.updated,
    current?.items,
    mindView.scene(),
    selection,
    selection.size,
    isSharedReadOnly(),
    collaboration?.shared.undo.undoStack.length,
    collaboration?.shared.undo.redoStack.length,
    history.past.length,
    history.future.length,
    language,
    copiedStyle,
    boards.length,
  ],
  entries: (recent) =>
    commandEntries({
      board: current ? { ...current, items: mindView.scene().items } : null,
      selection,
      anchor: selectionAnchor,
      focusedGroup,
      selectionOptions: selectionOptions(),
      readOnly: isSharedReadOnly(),
      commentReadOnly: isCommentReadOnly(),
      copiedStyle,
      boards,
      recent,
      undo: collaboration
        ? !!collaboration.shared.undo.undoStack.length
        : !!history.past.length,
      redo: collaboration
        ? !!collaboration.shared.undo.redoStack.length
        : !!history.future.length,
    }),
  prepare: () => {
    pointerUp();
    finishTextEdit();
    boardSearch.close(false);
    objectLinks.close();
  },
  modal,
  toast,
  run: runCommand,
});
async function runCommand(entry) {
  if (entry.boardId) {
    const destination = boards.find(
      (b) => b.id === entry.boardId && !b.deletedAt,
    );
    if (!destination) return;
    const origin = current;
    if (origin) {
      clearTimeout(cloudTimer);
      if (cloudIds.has(origin.id)) await sync(clone(origin));
      await saveChain;
      if (current !== origin) return;
    }
    return openBoard(destination);
  }
  if (entry.id.startsWith("add:")) return addObject(entry.id.slice(4));
  if (entry.id.startsWith("shape:")) return addShape(entry.id.slice(6));
  if (entry.id.startsWith("format:")) return formatSelection(entry.id.slice(7));
  if (entry.id.startsWith("font:"))
    return formatSelection("fontFamily", entry.id.slice(5));
  if (entry.id.startsWith("duplicate:")) return duplicate(entry.id.slice(10));
  if (entry.id.startsWith("arrange:"))
    return features.organizeSelection(entry.id.slice(8));
  if (entry.id === "zoom-selection")
    return focusRegion(
      bounds(visibleItems().filter((i) => selection.has(i.id))),
    );
  return action(entry.id);
}
const quickPorts = createQuickConnectUI({
  state: () => ({
    board: current,
    view,
    source:
      current &&
      selection.size === 1 &&
      tool === "select" &&
      !space &&
      !drag &&
      !editing &&
      !isSharedReadOnly() &&
      !boardSearch.isOpen() &&
      !objectLinks.isOpen() &&
      !hasLocked(current.items, selection)
        ? current.items.find((i) => selection.has(i.id) && canQuickConnect(i))
        : null,
  }),
  draw,
  activate: quickConnect,
  start: startQuickConnection,
  move: pointerMove,
  end: pointerUp,
  cancel: cancelTransform,
  focusCanvas: () => document.querySelector("#canvas")?.focus(),
});
const mindHandles = createMindMapHandles({
  state: () => {
    const source = selectedLinkObject();
    const available =
      source?.mindMap &&
      tool === "select" &&
      !space &&
      !drag &&
      !editing &&
      !isSharedReadOnly() &&
      !boardSearch.isOpen() &&
      !objectLinks.isOpen() &&
      !tableEditor.isOpen() &&
      !imageCrop.id() &&
      !document.querySelector("dialog[open]") &&
      !hasLocked(current.items, selection);
    return {
      board: current,
      view,
      source: available ? source : null,
      size: available
        ? document.querySelector("#canvas")?.getBoundingClientRect()
        : null,
    };
  },
  add: (direction) => mindMap.add(false, direction),
  focus: () =>
    document.querySelector("#canvas")?.focus({ preventScroll: true }),
});
const mindCollapse = createMindCollapse({
  state: () => ({
    board: current,
    scene: mindView.scene(),
    view,
    size: document.querySelector("#canvas")?.getBoundingClientRect() || {
      width: 0,
      height: 0,
    },
    selected: selectedLinkObject()?.id,
    hovered: hoveredMind,
    enabled:
      !!current &&
      tool === "select" &&
      !space &&
      !drag &&
      !editing &&
      !boardSearch.isOpen() &&
      !objectLinks.isOpen() &&
      !document.querySelector("dialog[open]"),
  }),
  toggle: toggleMindBranch,
  focus: () =>
    document.querySelector("#canvas")?.focus({ preventScroll: true }),
});
function toggleMindBranch(id = selectedLinkObject()?.id) {
  pointerUp();
  finishTextEdit();
  if (!mindView.scene().branches.has(id)) return;
  selectionAnchor = id;
  selection = descendants(current.items, new Set([id]));
  mindView.toggle(id);
}
// Selection is expanded at the interaction boundary. Commands receive the
// resolved ids so editing a member cannot silently expand back to its group.
function selectionOptions() {
  return { groups: false, withinGroup: focusedGroup };
}
function selectionGroup(
  chosen = current.items.filter((i) => selection.has(i.id)),
) {
  return selectionGroupId(chosen);
}
function selectItems(ids, { withinGroup = false } = {}) {
  attention.stop();
  pointerUp();
  mindView.invalidate();
  if (ids.size === 1) mindView.reveal([...ids][0]);
  selectionAnchor = ids.size === 1 ? [...ids][0] : null;
  focusedGroup = withinGroup
    ? current.items.find((i) => ids.has(i.id) && i.groupId)?.groupId || null
    : null;
  selection = descendants(current.items, ids, { groups: !focusedGroup });
}
function enterGroup(id = selectionAnchor) {
  const groupId = selectionGroup();
  if (!groupId || focusedGroup) return false;
  const member =
    current.items.find((i) => i.id === id && i.groupId === groupId) ||
    current.items.find((i) => selection.has(i.id) && i.groupId === groupId);
  selectItems(new Set([member.id]), { withinGroup: true });
  lastTap = null;
  draw();
  document.querySelector("#canvas")?.focus({ preventScroll: true });
  return true;
}
function exitGroup() {
  if (!focusedGroup) return false;
  const ids = new Set(
    current.items.filter((i) => i.groupId === focusedGroup).map((i) => i.id),
  );
  selectItems(ids);
  lastTap = null;
  draw();
  document.querySelector("#canvas")?.focus({ preventScroll: true });
  return true;
}
// Facilitator locks and hidden contributions protect objects like object locks.
// Deleting a frame or group would also delete what it holds, including
// content hidden from this person, so that is checked too.
function hasLocked(items, ids, options) {
  return (
    objectLocked(items, ids, options) ||
    facilitation.locked(
      options?.deleting ? descendants(items, ids, selectionOptions()) : ids,
    )
  );
}
function isSharedReadOnly() {
  return (
    collaborationBusy ||
    !!collaboration?.readOnly ||
    !!collaboration?.contentReadOnly ||
    (!!current?.shared && !collaboration)
  );
}
// Commenters cannot change content but can still discuss it.
function isCommentReadOnly() {
  return (
    collaborationBusy ||
    !!collaboration?.readOnly ||
    (!!current?.shared && !collaboration)
  );
}
function canEditSelection(ids = selection, options) {
  if (isSharedReadOnly()) {
    toast("This board is read-only.");
    return false;
  }
  if (!hasLocked(current.items, ids, options)) return true;
  toast("Unlock protected objects before changing this selection.");
  return false;
}
function toggleLock() {
  if (!selection.size) return;
  if (isSharedReadOnly()) return toast("This board is read-only.");
  pointerUp();
  const locked = current.items.some((i) => selection.has(i.id) && i.locked);
  const frame = current.items.find(
    (i) =>
      i.id === selectionAnchor &&
      selection.has(i.id) &&
      i.type === "frame" &&
      !i.groupId,
  );
  const ids = !locked && frame ? new Set([frame.id]) : selection;
  mutate(() => setLocked(current.items, ids, !locked));
  // A facilitator's lock can refuse it, saying why.
  if (!lockedAs(ids, !locked)) return;
  toast(
    locked
      ? "Selection unlocked."
      : frame
        ? "Frame locked. Its contents remain editable."
        : "Selection locked.",
  );
}
function unlockAll() {
  if (isSharedReadOnly()) return toast("This board is read-only.");
  const ids = new Set(current.items.filter((i) => i.locked).map((i) => i.id));
  if (!ids.size) return toast("No locked objects.");
  mutate(() => setLocked(current.items, ids, false));
  if (lockedAs(ids, false)) toast("All objects unlocked.");
}
// Whether the objects ended up locked, or unlocked, as asked.
const lockedAs = (ids, locked) =>
  current.items
    .filter((i) => ids.has(i.id))
    .every((i) => !!i.locked === locked);
function checkpoint(label = "Board edit", snapshot = clone(current)) {
  if (!snapshot) return;
  saveChain = saveChain
    .catch(() => {})
    .then(() => local.checkpoint(snapshot, label))
    .catch(() => toast("Could not save a recovery version. Export a backup."));
}
function focusRegion(a, searchPanel, avoidSelection = false) {
  attention.stop();
  const r = document.querySelector("#canvas").getBoundingClientRect();
  const availableWidth =
    searchPanel && r.width > 760
      ? Math.max(160, r.width - searchPanel.width - 32)
      : r.width;
  const selectionTools =
    avoidSelection && document.querySelector("#selection-tools");
  const belowPanel =
      searchPanel && r.width <= 760 ? searchPanel.bottom - r.top + 16 : 0,
    belowTools =
      selectionTools && !selectionTools.hidden
        ? selectionTools.getBoundingClientRect().bottom - r.top + 16
        : 0;
  // On a phone the search panel can cover nearly all of the canvas. Rather
  // than shrinking the result into the sliver left below it, the result is
  // framed as if the panel were closed, ready for when it is.
  const top =
    belowPanel && r.height - Math.max(belowPanel, belowTools) - 200 < 120
      ? belowTools
      : Math.max(belowPanel, belowTools);
  const availableHeight = Math.max(100, r.height - top);
  view.z = Math.max(
    0.15,
    Math.min(
      2,
      Math.min(
        (availableWidth - 70) / (a.w + 30),
        (availableHeight - 200) / (a.h + 30),
      ),
    ),
  );
  view.x = availableWidth / 2 - (a.x + a.w / 2) * view.z;
  view.y = top + (availableHeight - 80) / 2 - (a.y + a.h / 2) * view.z;
  draw();
}
try {
  theme = localStorage.getItem("whiteboard-theme") || "system";
  characterShortcuts =
    localStorage.getItem("whiteboard-character-shortcuts") !== "false";
  snapping = localStorage.getItem("whiteboard-snapping") !== "false";
  boardGrid = readGrid(localStorage.getItem(GRID_STORAGE_KEY));
  showDimensions = readDimensions(localStorage.getItem(DIMENSIONS_STORAGE_KEY));
  preciseSelection = readPreciseSelection(
    localStorage.getItem(PRECISE_SELECTION_KEY),
  );
} catch {}
function applyTheme() {
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  applyTheme();
  if (current) draw();
  else paintPreviews();
});
function iconsRefresh() {
  // Rendered SVGs keep data-lucide, so every call rebuilt every icon on each
  // pointer move. Convert placeholders only, then unmark the new SVGs.
  if (document.querySelector("i[data-lucide]")) {
    createIcons({ icons, attrs: { "stroke-width": 1.65 } });
    for (const svg of document.querySelectorAll("svg[data-lucide]"))
      svg.removeAttribute("data-lucide");
  }
  paintPreviews();
  translateUI();
}
// A modal dialog covers the page and makes it inert, so show toasts inside
// the topmost open dialog and return them to the page when it closes.
const toastElement = document.querySelector("#toast");
document.addEventListener(
  "close",
  (e) => {
    if (e.target.contains?.(toastElement)) document.body.append(toastElement);
  },
  true,
);
function toast(message) {
  const el = toastElement;
  const host =
    [...document.querySelectorAll("dialog[open]")].at(-1) || document.body;
  if (el.parentNode !== host) host.append(el);
  // Keep the source text in the translation cache so a still-visible
  // notification follows subsequent interface language changes.
  el.textContent = message;
  translateUI(el);
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 4500);
}
function status(text) {
  // Kept so rebuilding the editor, as for a language change, shows it again.
  status.text = text;
  status.board = current?.id;
  const el = document.querySelector("#save-state");
  if (el) el.textContent = t(text);
}
function save() {
  if (!current) return;
  if (current.comments?.length)
    current.comments = updateCommentAnchors(current.comments, current.items);
  if (
    !facilitation.beforeSave(
      collaboration && !collaborationBusy
        ? collaborationLastSaved || collaborationRendered
        : null,
    )
  )
    return;
  minimap.invalidate();
  boardSearch.refresh();
  current.updated = Date.now();
  const snapshot = clone(current);
  if (collaboration && !collaborationBusy) {
    const session = collaboration,
      before = clone(collaborationLastSaved || collaborationRendered);
    collaborationLastSaved = clone(snapshot);
    collaborationPendingEdits++;
    collaborationEdits = collaborationEdits
      .then(() => session.commit(snapshot, before))
      .catch((e) => {
        session.failure(e);
        toast(e.message);
      })
      .finally(() => {
        collaborationPendingEdits--;
      });
  }
  status("Saving…");
  saveChain = saveChain
    .catch(() => {})
    .then(() => local.save(snapshot))
    .then(
      () =>
        !snapshot.shared &&
        status(
          cloudIds.has(snapshot.id) ? "Saved locally" : "Saved on this device",
        ),
    )
    .catch(() => {
      status("Storage full");
      toast("Could not save locally. Export your board to keep a copy.");
    });
  if (cloudIds.has(snapshot.id) && !snapshot.shared) {
    pendingCloud.set(snapshot.id, JSON.stringify(snapshot));
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => sync(snapshot), 1500);
  }
}
async function sync(snapshot) {
  if (!cloud) return;
  try {
    status("Saving to Puter…");
    await cloud.save(snapshot);
    if (pendingCloud.get(snapshot.id) === JSON.stringify(snapshot))
      pendingCloud.delete(snapshot.id);
    status("Saved to Puter");
  } catch {
    status("Cloud save failed");
    toast(
      "Cloud save failed. Your local copy is safe. Use Save to Puter to retry.",
    );
  }
}
// A local undo step holds the objects, the tags, and the board's planning
// settings, so turning Kanban status sync on or off can be undone.
function undoState(items = current.items) {
  return { items, tags: current.tags || [], planning: current.planning };
}
function restoreUndoState(state) {
  Object.assign(current, state);
  if (!current.tags?.length) delete current.tags;
  if (!current.planning) delete current.planning;
}
// A change that continues the one before it, as a held arrow key does,
// records no undo step or recovery version of its own.
function mutate(fn, { mindLayout = false, continues = false } = {}) {
  if (isSharedReadOnly()) return toast("This board is read-only.");
  pointerUp();
  if (!continues) {
    checkpoint();
    if (!collaboration) history.push(undoState());
  }
  const priorMind = mindLayout
    ? []
    : current.items
        .filter((i) => i.mindMap)
        .map((i) => ({ ...i, mindMap: { ...i.mindMap } }));
  const taskParents = planning.parents();
  fn();
  planning.syncStatus(taskParents);
  mindView.invalidate();
  if (!mindLayout) preserveManualMindMoves(priorMind, current.items);
  autoLayoutMindMaps(current.items);
  minimap.invalidate();
  updateConnectors(current.items);
  draw();
  save();
}
// The library sidebar shows an icon beside each preference, like its other rows.
function themeControl(labelled = false) {
  return `<label class="language-control">${labelled ? icon("languages") : ""}<span class="sr-only">Language</span><select id="language" aria-label="Language"><option value="en" ${language === "en" ? "selected" : ""}>English</option><option value="fr" ${language === "fr" ? "selected" : ""}>Français</option></select></label><label class="theme-control">${icon("sun-moon")}<span class="sr-only">Appearance</span><select aria-label="Appearance" id="theme"><option value="system" ${theme === "system" ? "selected" : ""}>System</option><option value="light" ${theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${theme === "dark" ? "selected" : ""}>Dark</option></select></label>`;
}
const templates = [
  ["blank", "Blank board", "A fresh start", "plus"],
  ["brainstorm", "Brainstorm", "Let your ideas wander", "lightbulb"],
  ["mindmap", "Mind map", "Connect the dots", "network"],
  ["kanban", "Simple planner", "One step at a time", "columns-3"],
];
async function home({ keepAddress = false } = {}) {
  onboarding.close(false);
  tags.close();
  objectLinks.close();
  comments.close(false);
  textLinkPreview.close();
  canvasNavigation.finish();
  imageCrop.close(false);
  imageReplacement.close();
  commandPalette.close();
  pointerUp();
  finishTextEdit();
  boardSearch.close(false);
  if ((await leaveCollaboration()) === false) return;
  if (!keepAddress)
    window.history.replaceState(null, "", location.pathname + location.search);
  canvasNavigation.detach();
  minimap.detach();
  workshopTimer.detach();
  facilitation.detach();
  attention.detach();
  current = null;
  // Signing out or leaving the organization takes its boards list away, so
  // the library goes back to all boards.
  if (filter === "organization" && !organization.info) filter = "all";
  document.title = t("Your boards") + " · Whiteboard";
  app.innerHTML = `<div class="workspace"><aside class="sidebar"><a class="brand" href="#" aria-label="Whiteboard home">${logo}</a><div class="workspace-label">PERSONAL WORKSPACE</div><nav aria-label="Board library"><button data-filter="all" class="nav-item ${filter === "all" ? "active" : ""}">${icon("layout-dashboard")}All boards<span>${boards.filter((b) => !b.deletedAt).length}</span></button><button data-filter="favorites" class="nav-item ${filter === "favorites" ? "active" : ""}">${icon("star")}Favorites<span>${boards.filter((b) => b.favorite && !b.deletedAt).length}</span></button><button data-filter="trash" class="nav-item ${filter === "trash" ? "active" : ""}">${icon("trash-2")}Trash</button></nav>${organizationHome.sidebar()}<div class="sidebar-bottom"><button class="nav-item" data-action="cloud">${icon("cloud")}Puter cloud</button>${themeControl(true)}<a class="powered" href="https://developer.puter.com" target="_blank" rel="noopener">Powered by Puter ${icon("arrow-up-right")}</a></div></aside><main class="library"><header class="library-top"><span class="crumbs"><span class="crumb-parent">Workspace <span class="slash">/</span></span> <strong>${filter === "trash" ? "Trash" : filter === "favorites" ? "Favorites" : "All boards"}</strong></span><div class="top-right">${button("command", "Command palette (Ctrl/Cmd K)", "commands")}${button("users", "Join shared board", "join-shared")}${button("cloud", "Cloud boards", "cloud")}${button("circle-help", "Help and training", "help-center")}${button("keyboard", "Keyboard shortcuts", "help")}<span class="avatar" role="img" aria-label="Personal workspace">${icon("user-round")}</span></div></header><div class="library-body"><section aria-labelledby="start-heading"><div class="section-heading"><h2 id="start-heading">Start with a little inspiration</h2><button class="text-btn" data-action="templates">Browse all templates ${icon("arrow-up-right")}</button></div><div class="templates">${templates.map(([key, title, sub, ic]) => `<button class="template" data-template="${key}"><div class="template-art art-${key}">${key === "blank" ? `<span class="blank-plus">${icon("plus")}</span>` : preview(key === "blank" ? board("") : fromTemplate(key, language))}</div><div class="template-caption"><span class="template-icon">${icon(ic)}</span><span><strong>${title}</strong><small>${sub}</small></span>${icon("arrow-up-right")}</div></button>`).join("")}</div></section><section class="boards-section" aria-labelledby="boards-heading"><div class="boards-heading"><div><h2 id="boards-heading">${filter === "trash" ? "Trash" : filter === "favorites" ? "Favorite boards" : "Your boards"} <span class="count">${boards.filter((b) => (filter === "trash" ? !!b.deletedAt : !b.deletedAt) && (filter !== "favorites" || b.favorite)).length}</span></h2></div><button class="primary" data-action="new">${icon("plus")}New board</button></div><div class="board-filters"><label class="search">${icon("search")}<input id="search" aria-label="Search boards" placeholder="Search your boards" value="${escape(search)}"></label><label class="sort">${icon("arrow-down-wide-narrow")}<select id="sort" aria-label="Sort boards"><option value="recent">Last edited</option><option value="name" ${librarySort === "name" ? "selected" : ""}>Name</option></select></label>${button("upload", "Import board file", "import")}${button("import", "Migrate from Miro", "migrate-miro")}</div><div id="board-grid" class="board-grid"></div></section><footer class="library-footer"><button class="text-btn" data-action="help">Tips & shortcuts ${icon("arrow-up-right")}</button></footer></div></main></div>`;
  renderCards();
  bindShared();
  organizationHome.bind();
  document
    .querySelector('[data-filter="organization"]')
    ?.classList.toggle("active", filter === "organization");
  document
    .querySelectorAll("[data-template]")
    .forEach((el) => (el.onclick = () => newBoard(el.dataset.template)));
  document.querySelectorAll("[data-filter]").forEach((el) => {
    // Screen readers hear which list is showing, not only sighted users.
    if (el.dataset.filter === filter) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
    el.onclick = async () => {
      filter = el.dataset.filter;
      await home();
      // The library is rebuilt, so keep the keyboard on the chosen list.
      if (!current && document.activeElement === document.body)
        document.querySelector(`[data-filter="${filter}"]`)?.focus();
    };
  });
  document.querySelector("#search").oninput = (e) => {
    search = e.target.value;
    renderCards();
  };
  document.querySelector("#sort").onchange = (e) => {
    librarySort = e.target.value;
    renderCards();
  };
  iconsRefresh();
}
// Update the library's counts and cards in place, keeping scroll position,
// sorting, and focus.
function refreshLibrary() {
  if (current || !document.querySelector("#board-grid")) return;
  const live = boards.filter((b) => !b.deletedAt);
  document.querySelector('[data-filter="all"] > span:last-child').textContent =
    live.length;
  document.querySelector(
    '[data-filter="favorites"] > span:last-child',
  ).textContent = live.filter((b) => b.favorite).length;
  document.querySelector("#boards-heading .count").textContent = boards.filter(
    (b) =>
      (filter === "trash" ? !!b.deletedAt : !b.deletedAt) &&
      (filter !== "favorites" || b.favorite),
  ).length;
  if (filter !== "organization") renderCards();
}
function renderCards() {
  if (filter === "organization") {
    document.querySelector(".board-filters")?.setAttribute("hidden", "");
    const heading = document.querySelector("#boards-heading");
    if (heading) {
      // The organization view counts its own results below the filters.
      heading.firstChild.textContent = t("Organization boards");
      heading.querySelector(".count")?.setAttribute("hidden", "");
    }
    const crumb = document.querySelector(".library-top strong");
    if (crumb) crumb.textContent = t("Organization boards");
    return organizationHome.renderBoards(document.querySelector("#board-grid"));
  }
  let list = boards.filter(
    (b) =>
      (filter === "trash" ? !!b.deletedAt : !b.deletedAt) &&
      (filter !== "favorites" || b.favorite) &&
      b.title.toLowerCase().includes(search.toLowerCase()),
  );
  list.sort(
    librarySort === "name"
      ? (a, b) => a.title.localeCompare(b.title)
      : (a, b) => b.updated - a.updated,
  );
  document.querySelector("#board-grid").innerHTML = list.length
    ? list
        .map(
          // The name is the title alone; the object count and date are
          // read as the description.
          (b, n) =>
            `<article class="board-card"><button class="board-open" data-open="${escape(b.id)}" aria-label="Open ${escape(b.title)}" aria-describedby="board-card-${n}-meta"><div class="board-preview">${b.items.length ? preview(b) : `<span class="empty-preview">${icon("pencil-ruler")}<span>A world of possibility</span></span>`}</div><div class="board-info"><h3>${escape(b.title)}</h3><p id="board-card-${n}-meta">${b.items.length} objects <span>·</span> ${new Date(b.updated).toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", { month: "short", day: "numeric" })}</p></div></button><button class="favorite ${b.favorite ? "is-favorite" : ""}" data-favorite="${escape(b.id)}" aria-label="Favorite ${escape(b.title)}" aria-pressed="${!!b.favorite}">${icon("star")}</button><button class="card-more" data-more="${escape(b.id)}" aria-label="Options for ${escape(b.title)}">${icon("ellipsis")}</button></article>`,
        )
        .join("")
    : `<div class="empty-state">${icon(search ? "search" : "layers")}<h3>${search ? "No boards found" : filter === "favorites" ? "Keep your best ideas close" : "Your next idea starts here"}</h3><p>${search ? "Try a different name." : filter === "favorites" ? "Star a board to find it here." : "Create a board or choose a template above."}</p></div>`;
  document.querySelectorAll("[data-open]").forEach(
    (el) =>
      (el.onclick = () =>
        (() => {
          const b = boards.find((b) => b.id === el.dataset.open);
          if (b.deletedAt) boardOptions(b);
          else openBoard(b);
        })()),
  );
  document.querySelectorAll("[data-favorite]").forEach(
    (el) =>
      (el.onclick = async () => {
        const b = boards.find((b) => b.id === el.dataset.favorite);
        b.favorite = !b.favorite;
        await local.save(b);
        refreshLibrary();
        (
          [...document.querySelectorAll("[data-favorite]")].find(
            (button) => button.dataset.favorite === b.id,
          ) || document.querySelector('[data-filter="favorites"]')
        ).focus();
      }),
  );
  document
    .querySelectorAll("[data-more]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          boardOptions(boards.find((b) => b.id === el.dataset.more))),
    );
  iconsRefresh();
}
async function newBoard(template = "blank") {
  const b =
    template === "blank"
      ? board(t("Untitled board"))
      : fromTemplate(template, language);
  boards.push(b);
  await local.save(b);
  openBoard(b);
}
async function openBoard(b, { keepAddress = false } = {}) {
  if (current !== b && (await leaveCollaboration()) === false) return;
  current = b;
  if (!keepAddress)
    window.history.replaceState(
      null,
      "",
      objectAddress(b, undefined, location.href),
    );
  commandPalette.recordBoard(b.id);
  exportRegion = null;
  if (!b.items.some((i) => i.parentId)) inferParents(b.items);
  updateConnectors(b.items);
  selection.clear();
  history = new History();
  tool = "select";
  view = { x: 110, y: 85, z: 1 };
  status.board = null;
  // A board still being shared stays read-only until the shared copy,
  // made from it as it was, takes over; edits meanwhile would be lost.
  if (sharing && !sharing.done && sharing.target === b) {
    collaborationBusy = true;
    status("Setting up sharing…");
  }
  editor();
  if (b.items.length) fit();
  if (b.shared && !collaboration)
    await startCollaboration(b).catch((e) => {
      if (current === b) {
        collaborationBusy = false;
        toast(e.message);
      }
    });
}
const tools = [
  ["select", "mouse-pointer-2", "Select", "V"],
  ["hand", "hand", "Pan", "H"],
  ["note", "sticky-note", "Sticky note", "N"],
  ["text", "type", "Text", "T"],
  ["rect", "square", "Rectangle", "R"],
  ["ellipse", "circle", "Ellipse", "O"],
  ["arrow", "move-up-right", "Arrow", "A"],
  ["pen", "pencil", "Draw", "P"],
  ["frame", "scan", "Frame", "F"],
  ["comment", "message-square", "Comment", "C"],
];
const TOOL_HINTS = {
  select: "Select and move · Double-click to edit · Space to pan",
  hand: "Drag to move around your board",
  note: "Click the canvas to add a sticky note",
  text: "Click the canvas to add text",
  rect: "Click the canvas to add a rectangle",
  ellipse: "Click the canvas to add an ellipse",
  arrow: "Drag between objects to connect · Alt/Option for a free endpoint",
  pen: "Draw freely on the canvas",
  frame: "Click the canvas to add a frame",
  comment: "Click the canvas to add a comment",
  region: "Drag across the board to choose the area to export",
};
function editor() {
  tags.close();
  objectLinks.close();
  comments.close(false);
  textLinkPreview.close();
  canvasNavigation.finish();
  canvasNavigation.detach();
  minimap.detach();
  workshopTimer.detach();
  facilitation.detach();
  attention.detach();
  imageCrop.close(false);
  imageReplacement.close();
  commandPalette.close();
  pointerUp();
  finishTextEdit();
  boardSearch.close(false);
  document.title = current.title + " · Whiteboard";
  app.innerHTML = `<main class="editor"><header class="editor-header"><div class="editor-heading">${button("arrow-left", "Back to boards", "home")}<span class="mini-brand">${brandImage}</span><div><input id="board-title" aria-label="Board name" maxlength="200" value="${escape(current.title)}"><span id="save-state" role="status" aria-live="polite">${escape(status.board === current.id ? status.text : "Saved on this device")}</span></div></div><div class="editor-actions">${button("command", "Command palette (Ctrl/Cmd K)", "commands")}${themeControl()}${button("users", "Share board", "share")}${button("cloud-upload", "Save to Puter", "cloud-save")}${button("download", "Export board", "export")}${button("ellipsis", "More tools", "more-tools")}</div></header><div class="canvas-wrap"><canvas id="canvas" role="img" aria-label="Whiteboard canvas. Use Board objects to select and edit objects with the keyboard." tabindex="0"></canvas><div id="object-link-badges" class="object-link-badges" role="group" aria-label="Object links"></div><div id="comment-pins" class="comment-pins" role="group" aria-label="Board comments"></div><div id="board-outline" class="sr-only" role="group" aria-label="Canvas objects"></div><div class="tools panel" role="toolbar" aria-label="Drawing tools">${tools.map(([key, ic, label, shortcut]) => button(ic, `${label} (${shortcut})`, `tool-${key}`, `aria-pressed="${tool === key}"`)).join("")}<span class="tool-divider"></span>${button("shapes", "Shapes (S)", "shapes")}${button("image-plus", "Add image", "image")}</div><div class="drop-hint" aria-hidden="true"><strong>Drop content here</strong><span>Images, files, text, and links</span></div><div id="selection-tools" class="selection-tools panel" hidden></div><div id="quick-ports" role="group" hidden></div><section id="minimap" class="minimap panel" hidden></section><div class="canvas-top"><span class="board-tag">${icon("lock-keyhole")}${current.shared ? t("Shared board") : t("Personal board")}</span><button class="participants" data-action="participants" hidden></button><div class="canvas-navigation">${button("tags", "Tags", "tags", 'id="tag-access" hidden')}${button("columns-3", "Table cells", "table-cells", 'id="table-cell-access" hidden')}${button("arrow-up-right", "Object link", "object-link", 'id="object-link-access" hidden')}<button type="button" class="icon-btn timer-access" data-action="timer" data-timer-access aria-label="${t("Timer")}" title="${t("Timer")}" aria-controls="workshop-timer" aria-expanded="false">${icon("timer")}<span class="timer-badge" hidden></span></button><button type="button" class="icon-btn facilitation-access" data-action="facilitation" aria-label="${t("Facilitation")}" title="${t("Facilitation")}" aria-controls="facilitation-panel" aria-expanded="false">${icon("vote")}</button>${button("sparkles", "AI assistant", "ai")}${button("message-square", "Comments", "comments", 'aria-expanded="false" aria-controls="comments-panel"')}${button("link", "Text links", "text-links", 'id="text-link-access" hidden')}${button("search", "Find on board (Ctrl/Cmd F)", "board-search", 'aria-expanded="false" aria-controls="board-search"')}${button("map", "Minimap (M)", "minimap", 'aria-controls="minimap" aria-expanded="false" aria-pressed="false"')}${button("scan", "Frames and navigation", "frames")}${button("list", "Board objects", "objects")}${button("presentation", "Presentation", "present")}</div></div><div class="canvas-bottom"><div class="panel history-tools">${button("undo-2", "Undo (Ctrl/Cmd Z)", "undo")}${button("redo-2", "Redo (Ctrl/Cmd Shift Z)", "redo")}${button("magnet", "Snap to objects", "toggle-snapping", `aria-pressed="${snapping}"`)}</div><span id="tool-hint" class="tool-hint">Select and move · Double-click to edit · Space to pan</span><div class="panel zoom-tools">${button("minus", "Zoom out", "zoom-out")}<button class="zoom-label" data-action="reset-zoom" title="Reset zoom to 100 percent">100%</button>${button("plus", "Zoom in", "zoom-in")}<span class="tool-divider"></span>${button("maximize", "Fit board to screen", "fit")}</div></div><div id="empty-canvas" ${current.items.length ? "hidden" : ""}><span>${icon("sparkles")}</span><h1>A fresh space for a fresh idea.</h1><p>Add a sticky note, sketch a thought, or just start somewhere.</p><button class="primary" data-action="add-note">${icon("plus")}Add your first note</button></div></div></main>`;
  bindShared();
  workshopTimer.bind();
  facilitation.bind(document.querySelector(".canvas-wrap"));
  attention.bind(document.querySelector(".canvas-wrap"));
  quickPorts.bind(document.querySelector("#quick-ports"));
  const mindPorts = document.createElement("div");
  mindPorts.id = "mind-ports";
  mindPorts.setAttribute("role", "group");
  mindPorts.hidden = true;
  document.querySelector(".canvas-wrap").append(mindPorts);
  mindHandles.bind(mindPorts);
  const dimensions = document.createElement("output");
  dimensions.id = "object-dimensions";
  dimensions.className = "object-dimensions";
  dimensions.setAttribute("aria-label", t("Object dimensions"));
  dimensions.setAttribute("aria-live", "off");
  dimensions.hidden = true;
  document.querySelector(".canvas-wrap").append(dimensions);
  const collapsePorts = document.createElement("div");
  collapsePorts.id = "mind-collapse-ports";
  collapsePorts.setAttribute("role", "group");
  document.querySelector(".canvas-wrap").append(collapsePorts);
  mindCollapse.bind(collapsePorts);
  const mindHint = document.createElement("div");
  mindHint.id = "mind-drop-hint";
  mindHint.className = "mind-drop-hint panel";
  mindHint.setAttribute("role", "status");
  mindHint.hidden = true;
  document.querySelector(".canvas-wrap").append(mindHint);
  comments.bind(document.querySelector("#comment-pins"));
  objectLinks.bind(document.querySelector("#object-link-badges"));
  minimap.bind(document.querySelector("#minimap"));
  presenceLayer?.close();
  presenceLayer = new PresenceLayer(document.querySelector(".canvas-wrap"));
  renderParticipants();
  document.querySelector("#board-title").onchange = (e) => {
    checkpoint();
    current.title = e.target.value.trim() || t("Untitled board");
    e.target.value = current.title;
    document.title = current.title + " · Whiteboard";
    save();
  };
  const canvas = document.querySelector("#canvas");
  transfer.bindCanvas(document.querySelector(".canvas-wrap"));
  canvasNavigation.bind(canvas);
  canvas.addEventListener("pointerleave", () => {
    collaborationCursor = null;
    sendPresence();
  });
  // Offer the guided tour once, without interrupting anyone's work.
  if (onboarding.shouldStart()) {
    const offer = document.createElement("div");
    offer.id = "tour-offer";
    offer.className = "tour-offer panel";
    offer.setAttribute("role", "region");
    offer.setAttribute("aria-label", t("Getting started"));
    offer.innerHTML = `<span>${t("New here?")}</span><button class="text-btn" data-action="tour">${t("Take a one-minute tour")}</button>${button("x", "Dismiss", "dismiss-tour")}`;
    document.querySelector(".canvas-wrap").append(offer);
    offer
      .querySelectorAll("[data-action]")
      .forEach((b) => (b.onclick = () => action(b.dataset.action)));
  }
  draw();
}
function draw() {
  if (!current) return;
  if (focusedGroup) {
    const chosen = current.items.filter((i) => selection.has(i.id));
    if (chosen.some((i) => i.groupId && i.groupId !== focusedGroup)) {
      focusedGroup = selectionGroup(chosen);
      if (!focusedGroup) selection = descendants(current.items, selection);
    } else if (!chosen.some((i) => i.groupId === focusedGroup))
      focusedGroup = null;
  }
  workshopTimer.render();
  const mindScene = mindView.scene();
  if (selectionAnchor && mindScene.hidden.has(selectionAnchor)) {
    selectionAnchor = mindScene.hidden.get(selectionAnchor);
    selection = descendants(current.items, new Set([selectionAnchor]));
  } else if (mindScene.hidden.size) {
    const ids = [...selection].filter(
      (id) =>
        !mindScene.hidden.has(id) || selection.has(mindScene.hidden.get(id)),
    );
    if (ids.length !== selection.size) selection = new Set(ids);
  }
  tableEditor.render();
  // Losing edit access mid-gesture restores every kind of editing drag.
  if (
    (drag?.duplicate ||
      drag?.mind ||
      drag?.groupFocus ||
      ["move", "resize", "rotate", "endpoint", "arrow", "pen"].includes(
        drag?.kind,
      )) &&
    isSharedReadOnly()
  )
    return cancelTransform();
  const ctx = document.querySelector("#canvas").getContext("2d");
  if (tool === "select")
    document.querySelector("#canvas").style.cursor = drag?.duplicate
      ? "copy"
      : drag?.kind === "rotate"
        ? "grabbing"
        : drag?.kind === "resize"
          ? resizeCursor(drag.box)
          : "default";
  if (reflowTextItems(current.items, ctx)) {
    updateConnectors(current.items);
    if (drag?.kind === "rotate") {
      const byId = new Map(current.items.map((i) => [i.id, i]));
      if (
        drag.plan.items.some((original) => {
          const item = byId.get(original.id);
          return !item || item.w !== original.w || item.h !== original.h;
        })
      )
        return cancelTransform();
    }
    if (drag?.kind === "marquee") drag.index = null;
    minimap.invalidate();
  }
  const searching = boardSearch.isOpen();
  imageCrop.render();
  imageReplacement.refresh();
  const cropping = imageCrop.id();
  const selectionLocked = hasLocked(current.items, selection);
  let textPreview = false;
  let geometryPreview = false;
  const tablePreview = tableEditor.preview();
  // Others' recent drag previews and typing, looked up once per draw rather
  // than searched for every object; the first person listed wins.
  const now = Date.now(),
    remotePreviews = new Map(),
    remoteWriters = new Map();
  for (const person of collaborationPeople.values()) {
    if (now - person.at >= 2500 || now - (person.settling || now) > 3000)
      continue;
    for (const preview of person.preview || [])
      if (!remotePreviews.has(preview.id))
        remotePreviews.set(preview.id, preview);
    if (
      person.editing &&
      person.text !== null &&
      !remoteWriters.has(person.editing)
    )
      remoteWriters.set(person.editing, person);
  }
  let liveItems = mindScene.items.map((i) => {
    if (tablePreview?.id === i.id) {
      geometryPreview = true;
      return tablePreview;
    }
    if (editing?.item.id === i.id && growsWithText(i)) {
      textPreview = true;
      const preview = {
        ...i,
        text: editing.input.value,
        textRuns: editing.input.textRuns,
        textBlocks: editing.input.textBlocks,
      };
      setObjectHeight(preview, autoHeightLayout(preview, ctx).height);
      return preview;
    }
    if (selection.has(i.id) && drag) return i;
    // No one moves or retypes a locked object, and a preview never turns an
    // object into a drawing of another kind.
    if (i.locked) return i;
    const shown = remotePreviews.get(i.id);
    const { type, color, points, ...place } = shown || {};
    const p = shown && type !== undefined && type !== i.type ? place : shown;
    const writer = remoteWriters.get(i.id);
    if (!p && !writer) return i;
    if (p) geometryPreview = true;
    const preview = reusedPreview(i, {
      ...i,
      ...p,
      ...(writer
        ? {
            text: writer.text,
            textBlocks:
              writer.text === i.text
                ? i.textBlocks
                : replacedBlocks(i, writer.text),
            textRuns:
              writer.text === i.text
                ? i.textRuns
                : replaceTextRuns(i.text || "", writer.text, i.textRuns),
          }
        : {}),
    });
    if (growsWithText(preview)) {
      setObjectHeight(preview, autoHeightLayout(preview, ctx).height);
      textPreview = true;
    }
    return preview;
  });
  // Drawings and connectors others are still creating.
  if (collaborationPeople.size) {
    const shown = new Set(liveItems.map((i) => i.id));
    for (const person of collaborationPeople.values()) {
      if (now - person.at > 2500 || now - (person.settling || now) > 3000)
        continue;
      for (const preview of person.preview || [])
        if (preview.type && !shown.has(preview.id)) {
          shown.add(preview.id);
          liveItems.push(preview);
          geometryPreview = true;
        }
    }
  }
  if (textPreview || tablePreview || geometryPreview) {
    // Connector previews must never modify the saved scene or undo snapshots.
    liveItems = liveItems.map((i) => (i.type === "arrow" ? { ...i } : i));
    updateConnectors(liveItems);
  }
  liveItems = facilitation.conceal(
    facilitation.visible(liveItems.filter((i) => !mindScene.hidden.has(i.id))),
  );
  const resizeBox =
    selectionLocked || searching
      ? null
      : resizeBounds(liveItems, selection, selectionAnchor);
  const quickPreview = quickPorts.render();
  const badge =
    showDimensions &&
    !searching &&
    !editing &&
    !cropping &&
    !tableEditor.isOpen()
      ? dimensionBadge(
          resizeBox || dimensionBounds(liveItems, selection, selectionAnchor),
          view,
          document.querySelector("#canvas").getBoundingClientRect(),
        )
      : null;
  const dimensions = document.querySelector("#object-dimensions");
  dimensions.hidden = !badge;
  if (badge) {
    if (dimensions.textContent !== badge.label)
      dimensions.textContent = badge.label;
    dimensions.style.left = `${badge.x}px`;
    dimensions.style.top = `${badge.y}px`;
  }
  mindHandles.render();
  mindCollapse.render();
  const mindHint = document.querySelector("#mind-drop-hint");
  mindHint.hidden = !drag?.mind || !drag.active;
  if (!mindHint.hidden) {
    const candidate = drag.mindPreview;
    const target = current.items.find((i) => i.id === candidate?.id);
    const label = candidate?.error
      ? escape(t(candidate.error))
      : candidate
        ? `${escape(t("Release to attach to"))}: ${target?.text ? authoredTextHTML(target, target.text.slice(0, 100)) : escape(t("Untitled node"))} · ${escape(t("Hold Ctrl/Cmd to move without reassigning"))}`
        : escape(
            t(
              drag.pointer?.ctrlKey || drag.pointer?.metaKey
                ? "Moving branch without reassigning"
                : "Drag onto another node to move this branch · Hold Ctrl/Cmd to move freely",
            ),
          );
    if (mindHint._label !== label) {
      mindHint._label = label;
      mindHint.innerHTML = label;
    }
  }
  paint(document.querySelector("#canvas"), liveItems, view, {
    grid: boardGrid.mode,
    mindBadges: false,
    tags: current.tags,
    repaint: draw,
    selection:
      searching || cropping || tableEditor.isOpen() ? new Set() : selection,
    groupFocus:
      !searching && !cropping && !tableEditor.isOpen() ? focusedGroup : null,
    cropId: cropping,
    editingId: editing?.item.id,
    selectionLocked,
    ...boardSearch.highlights(),
    resizeBox:
      editing || cropping || tableEditor.isOpen() || drag?.kind === "rotate"
        ? null
        : resizeBox,
    guides: imageCrop.guides() || drag?.guides,
    connectorTarget: drag?.targetId,
    rotationAngle: drag?.kind === "rotate" ? drag.angle : undefined,
    rotationBox:
      drag?.kind === "rotate"
        ? { ...drag.plan.box, rotation: drag.angle }
        : undefined,
    rotationDisabled: isSharedReadOnly() || !!editing,
    quickPreview,
    marquee: drag?.marquee || exportRegion,
  });
  const outline = document.querySelector("#board-outline");
  const outlined = facilitation.conceal(visibleItems());
  const relationships = objectRelationships(outlined);
  const parts = outlined.map((i, n) =>
    outlineButton(i, selection.has(i.id), relationships.get(i.id), n),
  );
  // Compare with the buttons last written: panning and zooming redraw often
  // and change none of them, so the outline is not rebuilt then.
  const written = outline.renderedParts;
  if (
    written?.length !== parts.length ||
    parts.some((part, n) => part !== written[n])
  ) {
    outline.renderedParts = parts;
    outline.innerHTML = parts.join("");
    outline.querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          selectItems(new Set([b.dataset.id]));
          draw();
          document.querySelector("#canvas").focus();
        }),
    );
  }
  document.querySelector("#empty-canvas").hidden = !!current.items.length;
  document.querySelector(".zoom-label").textContent =
    Math.round(view.z * 100) + "%";
  document.querySelector('[data-action="undo"]').disabled = collaboration
    ? !collaboration.shared.undo.undoStack.length ||
      collaboration.contentReadOnly
    : !history.past.length;
  document.querySelector('[data-action="redo"]').disabled = collaboration
    ? !collaboration.shared.undo.redoStack.length ||
      collaboration.contentReadOnly
    : !history.future.length;
  renderSelectionTools(selectionLocked, resizeBox);
  const linkedItem =
    selection.size === 1 &&
    current.items.find(
      (i) => selection.has(i.id) && i.textRuns?.some((r) => r.style.link),
    );
  document.querySelector("#text-link-access").hidden = !linkedItem || !!editing;
  textLinkPreview.update();
  comments.render();
  objectLinks.render();
  facilitation.render();
  contentTools.render();
  tags.render();
  document.querySelector("#tag-access").hidden =
    !current.tags?.length &&
    !current.items.some((i) => selection.has(i.id) && taggable(i));
  document.querySelector("#object-link-access").hidden =
    !selectedLinkObject() || !!editing;
  document.querySelector("#table-cell-access").hidden =
    selectedLinkObject()?.type !== "table";
  minimap.render(
    liveItems,
    textPreview ||
      geometryPreview ||
      !!(drag && !["pan", "marquee", "region"].includes(drag.kind)),
  );
  commandPalette.refresh();
  positionTextEditor();
  updateTextFitStatus();
  presenceLayer?.render(
    facilitation.people(collaborationPeople),
    visibleItems(),
    view,
    collaboration?.session,
    attention.showCursors(),
  );
  attention.capture();
  planning.render();
  iconsRefresh();
  // Selections changed without the pointer, with the keyboard, the object
  // list or search, reach the others too, and a cleared one stops showing.
  if (collaboration && sharedSelectionKey() !== presenceSelection)
    sendPresence();
}
// Collaborators' live previews reuse one copy per object from draw to draw.
// Text layouts are cached per object, so a copy made afresh each frame would
// fit and wrap every previewed text again, however little it changed.
// Each object's button in the screen reader outline, made again only when
// something its name shows changes.
const outlineButtons = new WeakMap();
function outlineButton(i, pressed, relationship, index) {
  const key = [
    i.id,
    pressed,
    language,
    i.type,
    i.shape,
    i.locked,
    i.text,
    i.alt,
    i.fileName,
    i.cells,
    i.lang,
    i.textRuns,
    relationship,
    index,
  ];
  const cached = outlineButtons.get(i);
  if (cached?.key.every((value, n) => value === key[n])) return cached.html;
  const description = `outline-relationship-${index}`;
  const html = `<button data-id="${escape(i.id)}" aria-pressed="${pressed}"${relationship ? ` aria-describedby="${description}"` : ""}>${objectNameHTML(i)}</button>${relationship ? `<span class="sr-only" id="${description}">${relationship}</span>` : ""}`;
  outlineButtons.set(i, { key, html });
  return html;
}
function reusedPreview(item, next) {
  let copy = previewCopies.get(item);
  if (!copy) previewCopies.set(item, (copy = {}));
  for (const key of Object.keys(copy)) if (!(key in next)) delete copy[key];
  return Object.assign(copy, next);
}
function sharedSelection() {
  const ids = [];
  for (const id of selection) {
    if (ids.length === 100) break;
    ids.push(id);
  }
  return ids;
}
function sharedSelectionKey() {
  return sharedSelection().join(" ") + "|" + (editing?.item.id || "");
}
function textRangeValue(i, key) {
  if (editing?.item.id === i.id) return editing.input.rangeStyle(key);
  const base = key === "bold" ? textStyle(i).bold : (i[key] ?? false);
  const values = textSegments(i.text || "", i.textRuns).map(
    (s) => s.style[key] ?? base,
  );
  return values.every((v) => v === (values[0] ?? base))
    ? (values[0] ?? base)
    : "mixed";
}
function updateTextRangeControls() {
  updateListControls();
  const linkButton = document.querySelector("#text-link-options");
  if (linkButton)
    linkButton.setAttribute(
      "aria-pressed",
      String(!!editing?.input.linkRange().url),
    );
  if (!editing) return;
  for (const key of ["bold", "italic", "underline", "strike"]) {
    document
      .querySelector(`#format-${key}`)
      ?.setAttribute(
        "aria-pressed",
        String(editing.input.rangeStyle(key) || false),
      );
  }
  for (const [id, key] of [
    ["text-color", "textColor"],
    ["text-highlight", "highlight"],
  ]) {
    const value = editing.input.rangeStyle(key);
    const control = document.getElementById(id);
    if (control)
      control.value =
        value && value !== "mixed"
          ? value
          : key === "textColor"
            ? editing.input.defaultTextColor
            : "#fff099";
  }
}
function closeTextLinkEditor(focus = true) {
  const controls = document.querySelector("#text-link-controls");
  if (controls) {
    controls.hidden = true;
    controls.replaceChildren();
  }
  document
    .querySelector("#text-link-options")
    ?.setAttribute("aria-expanded", "false");
  if (focus && editing) editing.input.focus({ preventScroll: true });
}
function openTextLinkEditor() {
  if (!canEditSelection()) return;
  if (!editing) {
    const chosen = current.items.filter(
      (i) => selection.has(i.id) && canEditText(i),
    );
    if (chosen.length !== 1) return;
    beginTextEdit(chosen[0]);
  }
  const editor = editing,
    input = editor.input,
    range = input.linkRange();
  input.setSelectionRange(range.start, range.end);
  const controls = document.querySelector("#text-link-controls");
  if (!controls) return;
  controls.hidden = false;
  document
    .querySelector("#text-link-options")
    .setAttribute("aria-expanded", "true");
  const removable = input.textRuns.some(
    (r) => r.style.link && r.start < range.end && r.end > range.start,
  );
  controls.innerHTML = `<form class="text-link-form"><label class="field">Link URL<input id="text-link-url" type="text" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="https://example.com" value="${escape(range.url)}" aria-describedby="text-link-error" required></label><p id="text-link-error" role="alert" hidden></p><div class="text-link-actions">${range.url ? `<a class="text-btn" href="${escape(range.url)}" target="_blank" rel="noopener noreferrer">Open link in new tab</a>` : ""}${removable ? '<button id="text-link-remove" class="text-btn" type="button">Remove link</button>' : ""}<button id="text-link-cancel" class="secondary" type="button">Cancel</button><button class="primary" type="submit">Apply link</button></div></form>`;
  const field = controls.querySelector("input"),
    error = controls.querySelector("[role=alert]");
  const apply = (url) => {
    if (
      editing !== editor ||
      !current?.items.includes(editor.item) ||
      !canEditSelection(new Set([editor.item.id]))
    )
      return closeTextLinkEditor(false);
    if (
      range.start !== range.end &&
      input.selectionStart === input.selectionEnd
    ) {
      error.hidden = false;
      error.textContent = t("The selected text changed. Select it again.");
      return;
    }
    input.setLink(url);
    closeTextLinkEditor();
    positionTextEditor();
    updateTextRangeControls();
    updateTextFitStatus();
  };
  controls.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const url = textLinkURL(field.value, true);
    if (!url) {
      field.setAttribute("aria-invalid", "true");
      error.textContent = t("Enter a valid http or https link.");
      error.hidden = false;
      field.focus();
      return;
    }
    apply(url);
  };
  field.oninput = () => {
    field.removeAttribute("aria-invalid");
    error.hidden = true;
  };
  controls
    .querySelector("#text-link-remove")
    ?.addEventListener("click", () => apply(null));
  controls.querySelector("#text-link-cancel").onclick = () =>
    closeTextLinkEditor();
  controls.onkeydown = (e) => {
    if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      e.stopPropagation();
      closeTextLinkEditor();
    }
  };
  translateUI(controls);
  updateTextRangeControls();
  field.focus();
  field.select();
}
function replacedBlocks(i, text) {
  const prev = i.text || "",
    { start, end, insert } = textDifference(prev, text);
  return spliceTextBlocks(prev, i.textBlocks, start, end, insert);
}
function updateListControls() {
  const chosen =
    current?.items.filter((i) => selection.has(i.id) && canEditText(i)) || [];
  const values = editing
    ? [editing.input.listStyle()]
    : chosen.flatMap((i) =>
        textParagraphs(i.text || "", i.textBlocks).map((p) => p.list || false),
      );
  for (const kind of ["bullet", "number"]) {
    const value =
      values.length && values.every((v) => v === kind)
        ? "true"
        : values.some((v) => v === kind || v === "mixed")
          ? "mixed"
          : "false";
    document
      .querySelector(`#list-${kind}`)
      ?.setAttribute("aria-pressed", value);
  }
}
function formatListSelection(kind, indent) {
  if (!canEditSelection()) return;
  if (editing) {
    if (indent) editing.input.indentList(indent);
    else editing.input.setList(kind);
    positionTextEditor();
    updateTextFitStatus();
    return;
  }
  const chosen = current.items.filter(
    (i) => selection.has(i.id) && canEditText(i),
  );
  const remove = chosen.every((i) =>
    textParagraphs(i.text || "", i.textBlocks).every((p) => p.list === kind),
  );
  const changes = chosen.map((i) => ({
    i,
    blocks: indent
      ? indentTextBlocks(
          i.text || "",
          i.textBlocks,
          0,
          (i.text || "").length,
          indent,
        )
      : formatTextBlocks(
          i.text || "",
          i.textBlocks,
          0,
          (i.text || "").length,
          remove ? null : kind,
        ),
  }));
  if (
    !changes.some(
      ({ i, blocks }) =>
        JSON.stringify(blocks) !== JSON.stringify(i.textBlocks || []),
    )
  )
    return;
  mutate(() =>
    changes.forEach(({ i, blocks }) => {
      if (blocks.length) i.textBlocks = blocks;
      else delete i.textBlocks;
    }),
  );
}
function renderSelectionTools(locked, resizeBox) {
  const panel = document.querySelector("#selection-tools");
  const chosen = current.items.filter((i) => selection.has(i.id));
  const frame = chosen.find(
    (i) => i.id === selectionAnchor && i.type === "frame" && !i.groupId,
  );
  const textItems = locked ? [] : chosen.filter(canEditText);
  const fitItems = textItems.filter(canAutoFitText);
  const heightItems = textItems.filter((i) => i.type === "text");
  const heightPressed = heightItems.every(growsWithText)
    ? "true"
    : heightItems.some(growsWithText)
      ? "mixed"
      : "false";
  const allAuto = textItems.length && textItems.every((i) => i.autoFontSize);
  const fitPressed = fitItems.every((i) => i.autoFontSize)
    ? "true"
    : fitItems.some((i) => i.autoFontSize)
      ? "mixed"
      : "false";
  const common = (read) =>
    textItems.every((i) => read(i) === read(textItems[0]))
      ? read(textItems[0])
      : "";
  const lines = locked ? [] : chosen.filter((i) => i.type === "arrow");
  const lineControl = (key, label, choices, fallback) => {
    const value = lines.every(
      (i) => (i[key] ?? fallback) === (lines[0][key] ?? fallback),
    )
      ? (lines[0][key] ?? fallback)
      : "";
    if (
      key === "lineWidth" &&
      value !== "" &&
      !choices.some(([v]) => v === value)
    )
      choices.push([value, String(value)]);
    return `<label class="line-control"><span>${label}</span><select id="line-${key}" data-line="${key}"><option value="" disabled ${value === "" ? "selected" : ""}>Mixed</option>${choices.map(([v, name]) => `<option value="${v}" ${String(value) === String(v) ? "selected" : ""}>${name}</option>`).join("")}</select></label>`;
  };
  const formats = [
    ["bold", "bold", "Bold"],
    ["italic", "italic", "Italic"],
    ["underline", "underline", "Underline"],
    ["strike", "strikethrough", "Strikethrough"],
  ];
  const groupButton = focusedGroup
    ? button("group", "Select whole group", "exit-group")
    : selectionGroup(chosen)
      ? button("mouse-pointer-2", "Select object in group", "enter-group")
      : "";
  const styleButtons = `${button("copy-check", "Copy style (Ctrl/Cmd Alt/Option C)", "copy-style", `id="copy-style" ${chosen.length === 1 && canCopyStyle(chosen[0]) ? "" : "disabled"}`)}${button("paint-roller", "Paste style (Ctrl/Cmd Alt/Option V)", "paste-style", 'id="paste-style" disabled')}`;
  const mindSource = selectedLinkObject();
  const collapseButton =
    mindSource && mindView.scene().branches.has(mindSource.id)
      ? button(
          mindView.scene().counts.has(mindSource.id) ? "plus" : "minus",
          mindView.scene().counts.has(mindSource.id)
            ? "Expand branch"
            : "Collapse branch",
          "mind-collapse",
        )
      : "";
  const hideButton = facilitation.canHide()
    ? [...selection].every((id) => facilitation.hidden(id))
      ? button("eye", "Show to participants", "show-objects")
      : button("eye-off", "Hide from participants", "hide-objects")
    : "";
  const updateStyleControls = () => {
    const paste = panel.querySelector("#paste-style");
    if (paste)
      paste.disabled =
        locked ||
        isSharedReadOnly() ||
        !chosen.some((i) => canPasteStyle(i, copiedStyle));
  };
  const markup = !chosen.length
    ? ""
    : isSharedReadOnly() && !isCommentReadOnly()
      ? // Commenters can discuss and copy what they select, not change it.
        `<div class="selection-row">${button("message-square", "Add comment", "add-comment")}${button("image", "Copy as image (Ctrl/Cmd Shift C)", "copy-image")}</div>`
      : locked
        ? `<div class="selection-row locked-selection"><span>${icon("lock-keyhole")}<span>Protected selection</span></span>${groupButton}${!locked && selectedLinkObject()?.mindMap ? button("git-branch-plus", "Add child node", "mind-child") + button("list-plus", "Add sibling node", "mind-sibling") + button("network", "Mind map controls", "mind-settings") + button("git-pull-request-arrow", "Move mind map branch", "mind-move") : ""}${selectedLinkObject() ? button("arrow-up-right", "Object link", "object-link") : ""}${button("message-square", "Add comment", "add-comment")}${hideButton}${button("unlock", "Unlock selection", "lock", 'id="selection-lock"')}${button("copy", "Duplicate selection", "duplicate")}${button("image", "Copy as image (Ctrl/Cmd Shift C)", "copy-image")}${styleButtons}</div><p class="locked-hint">Unlock to move, edit, or delete.</p>`
        : `<div class="selection-row"><span class="selection-count">${selection.size} selected</span>${groupButton}${COLORS.map((c, n) => `<button class="swatch" style="--swatch:${c}" data-color="${c}" aria-label="${["Butter", "Sage", "Blue", "Lilac", "Peach", "White"][n]} color"></button>`).join("")}
    <label class="color-control" title="Custom color"><span class="sr-only">Custom color</span><input id="fill-color" type="color" value="${chosen[0].color || COLORS[0]}"></label>
    ${!locked && selectedLinkObject()?.mindMap ? button("git-branch-plus", "Add child node", "mind-child") + button("list-plus", "Add sibling node", "mind-sibling") + button("network", "Mind map controls", "mind-settings") + button("git-pull-request-arrow", "Move mind map branch", "mind-move") : ""}${selectedLinkObject() ? button("arrow-up-right", "Object link", "object-link") : ""}${chosen.some(taggable) ? button("tags", "Tags", "tags") : ""}${chosen.some((i) => i.type === "note") ? button("group", "Cluster sticky notes", "cluster") : ""}${button("message-square", "Add comment", "add-comment")}${hideButton}${button("pencil", "Edit selected object", "edit")}${chosen.length === 1 && chosen[0].type === "image" ? button("crop", "Crop image", "crop-image") + button("image-plus", "Replace image", "replace-image") : ""}${button("sliders-horizontal", "Object properties", "properties")}${chosen.some(canSwitchShape) ? button("shapes", "Change shape", "change-shape") : ""}${resizeBox ? button("scaling", frame ? "Resize frame" : "Resize selection", "resize") : ""}${rotationBox(current.items, selection) ? button("rotate-cw", "Rotate selection", "rotate") : ""}${button("copy", "Duplicate selection", "duplicate")}${button("image", "Copy as image (Ctrl/Cmd Shift C)", "copy-image")}${styleButtons}${button("bring-to-front", "Bring to front", "front")}${button("layers", "Organize selection", "organize")}${button("lock-keyhole", frame ? "Lock frame" : focusedGroup ? "Lock group" : "Lock selection", "lock", 'id="selection-lock"')}${chosen.some(canClearContent) ? button("eraser", "Clear content (Ctrl/Cmd Backspace)", "clear-content") : ""}${button("trash-2", "Delete selection", "delete")}</div>
    ${
      lines.length
        ? `<div class="selection-row line-format-tools" role="group" aria-label="Connection line formatting">
      ${lineControl(
        "lineType",
        "Path",
        [
          ["straight", "Straight"],
          ["elbow", "Elbow"],
          ["curved", "Curved"],
        ],
        "straight",
      )}
      ${lineControl(
        "lineStyle",
        "Stroke",
        [
          ["solid", "Solid"],
          ["dashed", "Dashed"],
          ["dotted", "Dotted"],
        ],
        "solid",
      )}
      ${lineControl(
        "lineWidth",
        "Thickness",
        [
          [1, "1"],
          [2.5, "2.5"],
          [4, "4"],
          [6, "6"],
          [8, "8"],
          [12, "12"],
        ],
        2.5,
      )}
      ${lineControl(
        "startCap",
        "Start",
        [
          ["none", "None"],
          ["arrow", "Arrowhead"],
          ["circle", "Dot"],
        ],
        "none",
      )}
      ${lineControl(
        "endCap",
        "End",
        [
          ["none", "None"],
          ["arrow", "Arrowhead"],
          ["circle", "Dot"],
        ],
        "arrow",
      )}
      ${chosen.length === 1 ? button("sliders-horizontal", "Connection endpoints", "connection-endpoints") : ""}
    </div>`
        : ""
    }
    ${
      textItems.length
        ? `<div class="selection-row text-format-tools" role="group" aria-label="Text formatting">
      <label class="font-family-control"><span class="sr-only">Font family</span><select id="font-family" aria-label="Font family"><option value="" disabled ${common(fontFamily) ? "" : "selected"}>Mixed</option>${FONT_FAMILIES.map((f) => `<option value="${f.id}" ${common(fontFamily) === f.id ? "selected" : ""}>${f.name}</option>`).join("")}</select></label>
      <label class="font-size-control"><span class="sr-only">${allAuto ? "Maximum font size" : "Font size"}</span><input id="font-size" type="number" min="8" max="100" step="1" value="${common((i) => textStyle(i).size)}" placeholder="Mixed" title="${allAuto ? "Maximum font size" : "Font size"}"></label>
      ${fitItems.length ? `<button type="button" id="auto-fit-text" class="text-btn" aria-label="Auto-fit text" title="Shrink text to fit. The font size is the maximum." aria-pressed="${fitPressed}">Auto-fit</button>` : ""}
      ${heightItems.length ? `<button type="button" id="auto-height-text" class="text-btn" title="Adjust height to fit the text. Resize to change its width." aria-pressed="${heightPressed}">Auto height</button>` : ""}
      ${formats.map(([key, ic, label]) => `<button id="format-${key}" class="icon-btn" data-format="${key}" aria-label="${label}" title="${label}" aria-pressed="${editing ? "false" : common((i) => textRangeValue(i, key)) === "" ? "mixed" : common((i) => textRangeValue(i, key))}">${icon(ic)}</button>`).join("")}
      <button id="text-list-options" class="icon-btn" type="button" aria-label="Lists" title="Lists" aria-expanded="false" aria-controls="text-list-controls">${icon("list")}</button>
      ${textItems.length === 1 ? `<button id="text-link-options" class="icon-btn" type="button" aria-label="Insert or edit text link" title="Insert or edit text link" aria-pressed="false" aria-expanded="false" aria-controls="text-link-controls">${icon("link")}</button>` : ""}
      <label class="text-align-control"><span class="sr-only">Text alignment</span><select id="text-align" title="Text alignment">${[
        ["", "Mixed"],
        ["left", "Align text left"],
        ["center", "Align text center"],
        ["right", "Align text right"],
      ]
        .map(
          ([value, label]) =>
            `<option value="${value}" ${common((i) => textStyle(i).align) === value ? "selected" : ""} ${value ? "" : "disabled"}>${label}</option>`,
        )
        .join("")}</select></label>
      <label class="color-control" title="Text color"><span class="sr-only">Text color</span><input id="text-color" type="color" value="${textStyle(textItems[0]).color}"></label>
      <button class="text-btn" id="text-color-auto" aria-label="Automatic text color" title="Automatic text color">Auto</button>
      <label class="color-control" title="Highlight text"><span class="sr-only">Highlight text</span><input id="text-highlight" type="color" value="${textItems[0].highlight || "#fff099"}"></label>
      <button class="text-btn" id="text-highlight-clear" title="Remove highlight">No highlight</button>
    </div><div id="text-link-controls" hidden></div><div id="text-list-controls" class="selection-row list-format-tools" role="group" aria-label="List formatting" hidden>
      <button id="list-bullet" class="text-btn" type="button" aria-pressed="false">${icon("list")}<span>Bulleted list</span></button>
      <button id="list-number" class="text-btn" type="button" aria-pressed="false">${icon("list-ordered")}<span>Numbered list</span></button>
      <button id="list-outdent" class="icon-btn" type="button" aria-label="Decrease indent" title="Decrease indent">${icon("indent-decrease")}</button>
      <button id="list-indent" class="icon-btn" type="button" aria-label="Increase indent" title="Increase indent">${icon("indent-increase")}</button>
    </div>${fitItems.length || heightItems.length ? '<p id="text-fit-status" class="text-fit-status" role="status" hidden></p>' : ""}${editing ? `<div class="text-edit-actions"><span>Editing text</span><button class="secondary" data-action="cancel-text" aria-label="Cancel text edit">Cancel</button><button class="primary" data-action="finish-text">${icon("check")}Done</button></div>` : ""}`
        : ""
    }`;
  panel.hidden = !chosen.length;
  const hiddenCount = [...selection].filter((id) =>
    mindView.scene().hidden.has(id),
  ).length;
  const markupKey = markup + collapseButton + hiddenCount;
  if (panel._markup === markupKey) {
    updateStyleControls();
    updateTextRangeControls();
    return;
  }
  const focusId = panel.contains(document.activeElement)
    ? document.activeElement.id
    : null;
  panel._markup = markupKey;
  panel.innerHTML = markup;
  const row = panel.querySelector(".selection-row");
  if (row) {
    if (!locked && !isSharedReadOnly() && chosen.length === 1) {
      row.insertAdjacentHTML(
        "beforeend",
        `<button id="content-language-options" class="icon-btn" type="button" aria-label="${t("Content language")}" title="${t("Content language")}" aria-expanded="false" aria-controls="content-language-controls">${icon("languages")}</button>`,
      );
      const controls = document.createElement("div");
      controls.id = "content-language-controls";
      controls.hidden = true;
      panel.append(controls);
      panel.querySelector("#content-language-options").onclick =
        openContentLanguage;
    }
    if (chosen.length > 1)
      row.insertAdjacentHTML(
        "afterbegin",
        button(
          "list-filter",
          "Filter selection",
          "filter-selection",
          'id="filter-selection"',
        ),
      );
    if (collapseButton) row.insertAdjacentHTML("afterbegin", collapseButton);
    if (groupButton) {
      const hint = document.createElement("p");
      hint.className = "locked-hint";
      hint.textContent = t(
        focusedGroup
          ? "Inside group · Double-click to edit · Escape selects the group"
          : "Double-click an object to select it within this group.",
      );
      panel.append(hint);
    }
    if (hiddenCount) {
      const hint = document.createElement("p");
      hint.className = "locked-hint";
      hint.textContent = `${hiddenCount} ${t("hidden in collapsed branches")}`;
      panel.append(hint);
    }
  }
  updateStyleControls();
  panel
    .querySelectorAll("[data-action]")
    .forEach((b) => (b.onclick = () => action(b.dataset.action)));
  panel
    .querySelectorAll("[data-color]")
    .forEach((b) => (b.onclick = () => fillSelection(b.dataset.color)));
  panel.querySelectorAll("[data-line]").forEach((input) => {
    input.onchange = () => {
      if (!canEditSelection()) return;
      const key = input.dataset.line;
      const value = key === "lineWidth" ? Number(input.value) : input.value;
      if (lines.every((i) => i[key] === value)) return;
      mutate(() =>
        lines.forEach((i) => {
          i[key] = value;
        }),
      );
    };
  });
  const fill = panel.querySelector("#fill-color");
  if (fill) fill.onchange = () => fillSelection(fill.value);
  panel
    .querySelectorAll("[data-format]")
    .forEach((b) => (b.onclick = () => formatSelection(b.dataset.format)));
  const listOptions = panel.querySelector("#text-list-options"),
    listControls = panel.querySelector("#text-list-controls");
  const linkOptions = panel.querySelector("#text-link-options");
  if (linkOptions) linkOptions.onclick = openTextLinkEditor;
  if (listOptions) {
    listOptions.onclick = () => {
      listControls.hidden = !listControls.hidden;
      listOptions.setAttribute("aria-expanded", String(!listControls.hidden));
      if (editing) {
        revealTextCaret();
        positionTextEditor();
      }
    };
    listControls.onkeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        listControls.hidden = true;
        listOptions.setAttribute("aria-expanded", "false");
        listOptions.focus();
      }
    };
    for (const kind of ["bullet", "number"])
      panel.querySelector(`#list-${kind}`).onclick = () =>
        formatListSelection(kind);
    panel.querySelector("#list-indent").onclick = () =>
      formatListSelection(null, 1);
    panel.querySelector("#list-outdent").onclick = () =>
      formatListSelection(null, -1);
  }
  const size = panel.querySelector("#font-size");
  const family = panel.querySelector("#font-family");
  if (family)
    family.onchange = () => formatSelection("fontFamily", family.value);
  if (size)
    size.onchange = () => {
      if (!size.value || !size.reportValidity()) return;
      formatSelection("fontSize", Number(size.value));
    };
  const align = panel.querySelector("#text-align");
  if (align) align.onchange = () => formatSelection("textAlign", align.value);
  const color = panel.querySelector("#text-color");
  if (color) color.onchange = () => formatSelection("textColor", color.value);
  const auto = panel.querySelector("#text-color-auto");
  if (auto) auto.onclick = () => formatSelection("textColor", null);
  const highlight = panel.querySelector("#text-highlight");
  if (highlight)
    highlight.onchange = () => formatSelection("highlight", highlight.value);
  const clearHighlight = panel.querySelector("#text-highlight-clear");
  if (clearHighlight)
    clearHighlight.onclick = () => formatSelection("highlight", null);
  const fit = panel.querySelector("#auto-fit-text");
  if (fit)
    fit.onclick = () => formatSelection("autoFontSize", fitPressed !== "true");
  const height = panel.querySelector("#auto-height-text");
  if (height)
    height.onclick = () =>
      formatSelection("autoHeight", heightPressed !== "true");
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  updateTextRangeControls();
}
function clearSelectionContent() {
  if (!selection.size) return toast("Select objects first.");
  const chosen = current.items.filter((i) => selection.has(i.id));
  if (!chosen.some(canClearContent))
    return toast("Select sticky notes or shapes to clear.");
  if (!canEditSelection()) return;
  if (!chosen.some(hasClearableContent))
    return toast("The selected content is already empty.");
  mutate(() => clearContent(current.items, selection));
  toast("Content cleared. Undo restores it.");
}
function fillSelection(color) {
  if (!canEditSelection()) return;
  mutate(() =>
    current.items
      .filter((i) => selection.has(i.id))
      .forEach((i) => (i.color = color)),
  );
}
function formatSelection(key, value) {
  if (!canEditSelection()) return;
  if (key === "fontFamily" && !validFontFamily(value)) return;
  if (editing && TEXT_STYLE_KEYS.includes(key)) {
    editing.input.format(key, value);
    positionTextEditor();
    updateTextFitStatus();
    return;
  }
  const chosen = current.items.filter(
    (i) =>
      selection.has(i.id) &&
      canEditText(i) &&
      (key !== "autoFontSize" || canAutoFitText(i)) &&
      (key !== "autoHeight" || i.type === "text"),
  );
  if (!chosen.length) return;
  if (value === undefined)
    value = !chosen.every((i) => textRangeValue(i, key) === true);
  if (
    chosen.every(
      (i) =>
        // null clears a style, which matches an unset property.
        ((key === "fontFamily" ? fontFamily(i) : i[key]) ?? null) ===
          (value ?? null) && !i.textRuns?.some((r) => key in r.style),
    )
  )
    return;
  mutate(() =>
    chosen.forEach((i) => {
      if (value === null) delete i[key];
      else i[key] = value;
      if (i.textRuns && TEXT_STYLE_KEYS.includes(key)) {
        const runs = formatTextRuns(
          i.text || "",
          i.textRuns,
          0,
          (i.text || "").length,
          { [key]: null },
        );
        if (runs.length) i.textRuns = runs;
        else delete i.textRuns;
      }
    }),
  );
}
function copyStyle() {
  const chosen = current?.items.filter((i) => selection.has(i.id)) || [];
  if (chosen.length !== 1 || !canCopyStyle(chosen[0]))
    return toast("Select one object with a copyable style.");
  copiedStyle = copyObjectStyle(chosen[0]);
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(copiedStyle));
  } catch {}
  toast("Style copied. Select objects and paste style.");
  draw();
}
function pasteStyle() {
  if (!current) return;
  if (!copiedStyle) return toast("Copy a style first.");
  if (!selection.size) return toast("Select objects first.");
  if (!canEditSelection()) return;
  const chosen = current.items.filter(
    (i) => selection.has(i.id) && canPasteStyle(i, copiedStyle),
  );
  if (!chosen.length)
    return toast("The copied style does not apply to this selection.");
  const changes = chosen
    .map((i) => ({ i, patch: objectStylePatch(i, copiedStyle) }))
    .filter(({ patch }) => patch);
  if (!changes.length) return toast("This style is already applied.");
  mutate(() => changes.forEach(({ i, patch }) => applyObjectStyle(i, patch)));
  toast("Style pasted.");
}
function updateTextFitStatus() {
  const status = document.querySelector("#text-fit-status");
  if (!status) return;
  const ctx = document.querySelector("#canvas").getContext("2d");
  const overflow = current.items.some(
    (i) =>
      selection.has(i.id) &&
      i.autoFontSize &&
      canAutoFitText(i) &&
      fitTextLayout(
        i,
        ctx,
        editing?.item.id === i.id ? editing.input.value : i.text || "",
        undefined,
        editing?.item.id === i.id ? editing.input.textRuns : i.textRuns,
        editing?.item.id === i.id ? editing.input.textBlocks : i.textBlocks,
      ).overflow,
  );
  const tooTall = current.items.some(
    (i) =>
      selection.has(i.id) &&
      growsWithText(i) &&
      autoHeightLayout(
        i,
        ctx,
        editing?.item.id === i.id ? editing.input.value : i.text || "",
        editing?.item.id === i.id ? editing.input.textRuns : i.textRuns,
        editing?.item.id === i.id ? editing.input.textBlocks : i.textBlocks,
      ).overflow,
  );
  status.hidden = !overflow && !tooTall;
  const message = tooTall
    ? t(
        "Text exceeds the board height limit. Widen the box or split the text into separate boxes.",
      )
    : overflow
      ? t(
          "Some text does not fit at the minimum size. Enlarge the object or shorten the text.",
        )
      : "";
  if (status.textContent !== message) status.textContent = message;
}
function positionTextEditor() {
  if (!editing) return;
  const { item: i, input } = editing;
  const defaults =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--text")
      .trim() || "#30342f";
  const ctx = document.querySelector("#canvas").getContext("2d");
  const fitted =
    i.autoFontSize && canAutoFitText(i)
      ? fitTextLayout(
          i,
          ctx,
          input.value,
          defaults,
          input.textRuns,
          input.textBlocks,
        )
      : null;
  const style = fitted?.style || textStyle(i, defaults);
  const layout =
    fitted ||
    (i.type === "rect" && i.shape
      ? shapeTextLayout(i, ctx, input.value, input.textRuns, input.textBlocks)
      : null);
  const box =
    i.type === "arrow"
      ? connectorLabel({
          ...i,
          text: input.value,
          textRuns: input.textRuns,
          textBlocks: input.textBlocks,
        })
      : layout
        ? { ...layout.box, x: i.x + layout.box.x, y: i.y + layout.box.y }
        : growsWithText(i)
          ? {
              ...i,
              h: autoHeightLayout(
                i,
                ctx,
                input.value,
                input.textRuns,
                input.textBlocks,
              ).height,
            }
          : { ...i, h: i.h - tagFooter(i) };
  const origin = worldPoint(i, box);
  Object.assign(input.style, {
    left: `${view.x + origin.x * view.z}px`,
    top: `${view.y + origin.y * view.z}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
    background: i.type === "arrow" ? "#ffffff" : "transparent",
    transform: `scale(${view.z}) rotate(${rotationOf(i)}deg)`,
    padding: `${style.padding}px`,
    paddingTop: `${layout?.top ?? style.padding}px`,
    font: style.font,
    lineHeight: "1.35",
    color: style.color,
    textAlign: style.align,
    textDecoration: "none",
    overflow:
      growsWithText(i) &&
      !autoHeightLayout(i, ctx, input.value, input.textRuns, input.textBlocks)
        .overflow
        ? "hidden"
        : "auto",
  });
  input.setBaseStyle(
    i,
    textStyle({ ...i, textColor: undefined }, defaults).color,
  );
  input.setListMetrics(ctx, style);
  if (input.style.overflow === "hidden") input.scrollTop = 0;
}
function revealTextCaret() {
  if (!editing || !growsWithText(editing.item)) return;
  const canvas = document.querySelector("#canvas");
  const rect = canvas.getBoundingClientRect();
  if (!rect.height) return;
  const { item: i, input } = editing;
  const height = autoHeightLayout(
    i,
    canvas.getContext("2d"),
    input.value.slice(
      0,
      input.selectionDirection === "backward"
        ? input.selectionStart
        : input.selectionEnd,
    ),
    input.textRuns,
    input.textBlocks,
  ).height;
  if (rotationOf(i)) {
    const selection = window.getSelection(),
      range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const caret = range?.getBoundingClientRect?.();
    if (caret?.height) {
      const margin = Math.min(120, rect.height / 4);
      if (caret.bottom > rect.bottom - margin)
        view.y -= caret.bottom - rect.bottom + margin;
      else if (caret.top < rect.top + margin)
        view.y += rect.top + margin - caret.top;
      if (caret.right > rect.right - margin)
        view.x -= caret.right - rect.right + margin;
      else if (caret.left < rect.left + margin)
        view.x += rect.left + margin - caret.left;
    }
    return;
  }
  const lineHeight = textStyle(i).size * 1.35 * view.z;
  const bottom = view.y + (i.y + height) * view.z;
  const top = bottom - lineHeight;
  const margin = Math.min(120, rect.height / 4);
  const toolbar = document
    .querySelector("#selection-tools")
    .getBoundingClientRect();
  const topMargin = Math.max(margin, toolbar.bottom - rect.top + 12);
  if (bottom > rect.height - margin) view.y -= bottom - rect.height + margin;
  else if (top < topMargin) view.y += topMargin - top;
}
// Whether a shortcut held with Alt/Option is one of `keys`. Option on a Mac
// changes the character a key types (Option K types "˚"), so the key's
// position counts when no plain letter or sign comes through; otherwise the
// character does, as on layouts that place letters elsewhere.
function optionKey(e, keys, codes) {
  if (!e.altKey) return false;
  const key = e.key.toLowerCase();
  if (/^[a-z0-9=+_-]$/.test(key)) return keys.includes(key);
  return codes.includes(e.code);
}
function beginTextEdit(i, { inheritLanguage = true } = {}) {
  if (!canEditSelection(new Set([i.id]))) return;
  finishTextEdit();
  const input = createTextEditor(document, i, {
    inheritLanguage,
    onSelection: updateTextRangeControls,
    history: collaboration
      ? (redo) => sharedStep(redo ? "redo" : "undo")
      : undefined,
  });
  input.addEventListener("keydown", (e) => mindMap.keydown(e, true), true);
  input.id = "canvas-text-editor";
  input.className = "canvas-text-editor";
  input.setAttribute("aria-label", t("Edit text on canvas"));
  input.setAttribute("aria-describedby", "text-edit-hint");
  input.maxLength = 20000;
  input.value = i.text || "";
  input.spellcheck = true;
  input.addEventListener("focus", () => closeTextLinkEditor(false));
  input.addEventListener("input", () => {
    if (growsWithText(editing?.item || i)) {
      revealTextCaret();
      draw();
    } else positionTextEditor();
    updateTextFitStatus();
  });
  input.addEventListener("keydown", (e) => {
    if (
      !e.isComposing &&
      growsWithText(editing?.item || i) &&
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(e.key)
    ) {
      // Wait for native caret movement. Safari can omit keyup for Cmd+arrows.
      requestAnimationFrame(() => {
        if (editing?.input !== input || document.activeElement !== input)
          return;
        revealTextCaret();
        draw();
      });
    }
  });
  const hint = document.createElement("span");
  hint.id = "text-edit-hint";
  hint.className = "sr-only";
  hint.textContent = t(
    i.mindMap
      ? "Ctrl or Cmd + Enter to finish. Escape to cancel."
      : "Ctrl or Cmd + Enter to finish. Escape to cancel. Enter adds a new line.",
  );
  editing = { item: i, input, hint };
  if (collaboration) {
    hint.textContent = t("Changes are shared as you type. Escape to finish.");
    editing.sharedChange = (text, runs, blocks) => {
      const row = current.items.find((r) => r.id === i.id);
      if (row) {
        row.text = text;
        if (runs?.length) row.textRuns = runs;
        else delete row.textRuns;
        if (blocks?.length) row.textBlocks = blocks;
        else delete row.textBlocks;
      }
      if (row && growsWithText(row)) draw();
      else positionTextEditor();
      updateTextFitStatus();
      sendPresence();
    };
    editing.unbind = bindText(collaboration, i.id, input, editing.sharedChange);
  }
  if (!i.mindMap)
    hint.textContent +=
      " " +
      t(
        "In lists, Tab changes indent, Shift+Enter continues an item, and Enter on an empty item exits the list.",
      );
  if (i.mindMap)
    hint.textContent +=
      " " +
      t(
        "Tab adds a child · Enter adds a sibling · Shift+Enter adds a line · Arrow keys navigate nodes",
      );
  selection = new Set([i.id]);
  selectionAnchor = i.id;
  focusedGroup = i.groupId || null;
  document.querySelector(".canvas-wrap").append(input, hint);
  input.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if ((e.metaKey || e.ctrlKey) && optionKey(e, ["k"], ["KeyK"])) {
      e.preventDefault();
      e.stopPropagation();
      openTextLinkEditor();
      return;
    }
    if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
      e.preventDefault();
      e.stopPropagation();
      finishTextEdit(e.key !== "Escape", true);
    } else if (
      (e.metaKey || e.ctrlKey) &&
      ["b", "i", "u"].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
      formatSelection(
        { b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()],
      );
    }
  });
  draw();
  input.focus({ preventScroll: true });
  input.select();
  sendPresence();
}
function finishTextEdit(commit = true, focus = false) {
  tableEditor.close(commit);
  if (!editing) return;
  const { item: i, input, hint, unbind } = editing;
  unbind?.();
  if (collaboration) {
    commit = true;
    presenceSettling = Date.now() + 2000;
  }
  editing = null;
  const text = input.value.slice(0, 20000);
  const runs = input.textRuns,
    blocks = input.textBlocks;
  input.destroy();
  input.remove();
  hint.remove();
  if (
    commit &&
    (text !== (i.text || "") ||
      JSON.stringify(runs) !== JSON.stringify(i.textRuns || []) ||
      JSON.stringify(blocks) !== JSON.stringify(i.textBlocks || []))
  )
    mutate(() => {
      i.text = text;
      if (runs.length) i.textRuns = runs;
      else delete i.textRuns;
      if (blocks.length) i.textBlocks = blocks;
      else delete i.textBlocks;
    });
  else draw();
  sendPresence();
  if (focus) document.querySelector("#canvas")?.focus({ preventScroll: true });
}
// Commit before another control changes the board; formatting retains the draft.
document.addEventListener(
  "pointerdown",
  (e) => {
    textLinkPreview.outside(e.target);
    if (editing && !e.target.closest("#canvas-text-editor,#selection-tools"))
      finishTextEdit();
  },
  true,
);
document.addEventListener("focusin", (e) => {
  if (e.target.id !== "canvas") canvasNavigation.finish();
  if (drag && e.target.id !== "canvas") pointerUp();
  if (editing && !e.target.closest("#canvas-text-editor,#selection-tools"))
    finishTextEdit();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    canvasNavigation.cancel();
    minimap.cancel();
    quickPorts.cancel();
    mindHandles.cancel();
    mindCollapse.cancel();
    tableEditor.cancelResize();
    pointerUp();
    finishTextEdit();
  }
});

function canvasPoint(e) {
  const r = document.querySelector("#canvas").getBoundingClientRect();
  return {
    x: (e.clientX - r.left - view.x) / view.z,
    y: (e.clientY - r.top - view.y) / view.z,
  };
}
// The board point in the middle of the view.
function viewCenter() {
  const r = document.querySelector("#canvas").getBoundingClientRect();
  return {
    x: (r.width / 2 - view.x) / view.z,
    y: (r.height / 2 - view.y) / view.z,
  };
}
// Where a new sticky note's corner goes for it to sit in the middle.
function center() {
  const c = viewCenter();
  return { x: c.x - 95, y: c.y - 80 };
}
function setTool(value) {
  attention.stop();
  if (
    isSharedReadOnly() &&
    !["select", "hand", "region"].includes(value) &&
    // Commenters discuss content they cannot change.
    !(value === "comment" && !isCommentReadOnly())
  )
    return;
  canvasNavigation.finish();
  pointerUp();
  tool = value;
  onboarding.tip(value, toast);
  selection.clear();
  showTool();
  draw();
}
function showTool() {
  document
    .querySelectorAll('[data-action^="tool-"]')
    .forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.action === "tool-" + tool),
    );
  document.querySelector("#canvas").style.cursor =
    tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
  document.querySelector("#tool-hint").textContent = TOOL_HINTS[tool] || "";
}
function activeGridStep(event) {
  return boardGrid.snap && !event?.altKey && !event?.ctrlKey && !event?.metaKey
    ? gridStep(view.z)
    : 0;
}
function gridPlaceItems(items) {
  const step = activeGridStep();
  if (!step || !items.length) return;
  const box = bounds(items),
    point = snapGridPoint(box, step),
    dx = point.x - box.x,
    dy = point.y - box.y;
  if (items.some((i) => Math.abs(i.x + dx) > 1e6 || Math.abs(i.y + dy) > 1e6))
    return;
  for (const i of items) {
    i.x += dx;
    i.y += dy;
  }
}
function addObject(type, p = center(), extra = {}, event) {
  if (isSharedReadOnly()) return toast("This board is read-only.");
  if (current.items.length >= 5000)
    return toast("A board can contain at most 5,000 objects.");
  p = snapGridPoint(p, activeGridStep(event));
  const generatedText =
    type === "text" && extra.text === undefined ? t("Your text") : null;
  let created;
  mutate(() => {
    const i = item(type, p.x, p.y, {
      color: COLORS[0],
      ...(type === "text" ? { autoHeight: true } : {}),
      ...(generatedText !== null
        ? {
            text: generatedText,
            textRuns: [
              {
                start: 0,
                end: generatedText.length,
                style: { lang: language },
              },
            ],
          }
        : {}),
      ...(type === "frame" ? { w: 420, h: 320, text: "Frame" } : {}),
      ...extra,
    });
    if (growsWithText(i))
      i.h = autoHeightLayout(
        i,
        document.querySelector("#canvas").getContext("2d"),
      ).height;
    current.items.push(i);
    created = i;
    inferParents(current.items, new Set([i.id]), {
      skip: facilitation.concealedIds(),
    });
    selection = new Set([i.id]);
  });
  setToolAfterAdd();
  // A save the board refused, as on a board the facilitator froze, took
  // the object back and said why; there is nothing to edit.
  if (!current.items.some((i) => i.id === created.id)) return;
  if (["note", "text"].includes(type))
    beginTextEdit(created, { inheritLanguage: generatedText === null });
  return created;
}
function addShape(key) {
  if (!canEditSelection(new Set())) return;
  if (current.items.length >= 5000)
    return toast("A board can contain at most 5,000 objects.");
  // Library shapes come in many sizes; each lands centred in the view.
  const props = { w: 280, h: 180, ...shapeDefaults(key) },
    c = viewCenter();
  const created = addObject(
    key === "ellipse" ? "ellipse" : "rect",
    { x: c.x - props.w / 2, y: c.y - props.h / 2 },
    { ...props, ...(CUSTOM_SHAPES.has(key) ? { shape: key } : {}) },
  );
  if (created) beginTextEdit(created);
}
function setToolAfterAdd() {
  tool = "select";
  // The buttons, cursor, and hint all follow the select tool.
  showTool();
}
function quickConnect(id, direction) {
  if (!canEditSelection(new Set([id]))) return;
  try {
    const plan = quickConnectPlan(
      current.items,
      id,
      direction,
      facilitation.concealedIds(),
    );
    if (plan.existing) {
      selectItems(new Set([plan.line.id]));
      draw();
      document.querySelector("#canvas").focus();
      return;
    }
    mutate(() => {
      current.items.push(...plan.added);
      selection = new Set([plan.node?.id || plan.line.id]);
      selectionAnchor = plan.node?.id || plan.line.id;
    });
    // Refused, as on a board the facilitator locked: the refusal says why.
    if (!current.items.includes(plan.added[0])) return;
    if (plan.node) {
      revealQuickObject(plan.node);
      beginTextEdit(plan.node);
    } else document.querySelector("#canvas").focus();
  } catch (error) {
    toast(error.message);
  }
}
function revealQuickObject(i, { minimal = false } = {}) {
  const r = document.querySelector("#canvas").getBoundingClientRect();
  const left = r.width < 760 ? 24 : 90,
    right = r.width - (minimal ? 90 : 30);
  const top = minimal ? 180 : 140,
    bottom = r.height - (r.width < 760 ? 200 : minimal ? 100 : 70);
  view.z = Math.max(
    0.15,
    Math.min(
      view.z,
      Math.max(80, right - left) / i.w,
      Math.max(80, bottom - top) / i.h,
    ),
  );
  const x = view.x + i.x * view.z,
    y = view.y + i.y * view.z;
  const w = i.w * view.z,
    h = i.h * view.z;
  if (x < left || x + w > right)
    view.x += minimal
      ? x < left
        ? left - x
        : right - x - w
      : (left + right - w) / 2 - x;
  if (y < top || y + h > bottom)
    view.y += minimal
      ? y < top
        ? top - y
        : bottom - y - h
      : (top + bottom - h) / 2 - y;
  draw();
}
function startQuickConnection(id, event) {
  const source = current?.items.find((i) => i.id === id);
  if (!canQuickConnect(source) || !canEditSelection(new Set([id])))
    return false;
  if (current.items.length >= 5000) {
    toast("A board can contain at most 5,000 objects.");
    return false;
  }
  pointerUp();
  document.querySelector("#canvas").focus({ preventScroll: true });
  const original = clone(current.items),
    previousSelection = new Set(selection);
  const line = item("arrow", source.x + source.w / 2, source.y + source.h / 2, {
    w: 0,
    h: 0,
    startId: id,
  });
  current.items.push(line);
  selection = new Set([line.id]);
  drag = {
    kind: "arrow",
    id: line.id,
    start: canvasPoint(event),
    original,
    previousSelection,
    previousAnchor: selectionAnchor,
    previousGroup: focusedGroup,
    line: clone(line),
    changed: false,
    gridStep: activeGridStep(),
  };
  lastTap = null;
  draw();
  return true;
}
function snapViewport() {
  const r = document.querySelector("#canvas").getBoundingClientRect();
  return {
    x: -view.x / view.z,
    y: -view.y / view.z,
    w: (r.width || 300) / view.z,
    h: (r.height || 150) / view.z,
  };
}
function snapIndex() {
  return createSnapIndex(visibleItems(), selection, snapViewport());
}
function cancelTransform() {
  quickPorts.resetGesture();
  if (drag?.kind === "table-cells") {
    tableEditor.end(true);
    drag = null;
    draw();
    return;
  }
  if (drag && ["marquee", "region"].includes(drag.kind)) {
    if (drag.kind === "region") exportRegion = drag.previousRegion;
    else {
      const existing = new Set(current.items.map((i) => i.id));
      selection = new Set(
        [...drag.previousSelection].filter((id) => existing.has(id)),
      );
      focusedGroup = drag.previousGroup || null;
      selectionAnchor = selection.has(drag.previousAnchor)
        ? drag.previousAnchor
        : null;
    }
    drag = null;
    lastTap = null;
    draw();
    return;
  }
  if (drag?.kind === "pan") {
    view = drag.view;
    drag = null;
    draw();
    return;
  }
  if (
    !drag ||
    !["move", "resize", "rotate", "endpoint", "arrow", "pen"].includes(
      drag.kind,
    )
  )
    return pointerUp();
  if (["arrow", "pen"].includes(drag.kind)) {
    selection = drag.previousSelection;
    selectionAnchor = drag.previousAnchor;
    focusedGroup = drag.previousGroup;
  }
  if (drag.duplicate) {
    selection = drag.duplicate.sourceSelection;
    selectionAnchor = drag.duplicate.sourceAnchor;
    focusedGroup = drag.duplicate.sourceGroup;
  }
  current.items = drag.original;
  drag = null;
  presenceSettling = 0;
  sendPresence();
  lastTap = null;
  draw();
}
function startMarquee(p, e, precise = preciseSelection) {
  const previousSelection = new Set(selection),
    previousAnchor = selectionAnchor,
    previousGroup = focusedGroup;
  selection = e.shiftKey ? descendants(current.items, selection) : new Set();
  focusedGroup = null;
  selectionAnchor = null;
  drag = {
    kind: "marquee",
    start: p,
    precise,
    previousSelection,
    previousAnchor,
    previousGroup,
    baseSelection: descendants(current.items, previousSelection),
    index: createMarqueeIndex(current.items, visibleItems()),
  };
}
function updateMarqueeSelection(rect, shiftKey) {
  drag.index ||= createMarqueeIndex(current.items, visibleItems());
  selection = new Set([
    ...(shiftKey ? drag.baseSelection : []),
    ...marqueeSelection(drag.index, rect, drag.precise),
  ]);
}
function pointerDown(e, { marquee = false, precise = preciseSelection } = {}) {
  imageCrop.close(false);
  imageReplacement.close();
  if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
  // A stationary long press replaces an uncommitted click. Do not activate its
  // link/table or finish a drag before starting precise selection over it.
  if (marquee) drag = null;
  pointerUp();
  e.preventDefault();
  document.querySelector("#canvas").focus({ preventScroll: true });
  const canvas = e.currentTarget;
  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {}
  boardSearch.close(false);
  if (space || tool === "hand" || e.button === 1 || e.button === 2) {
    drag = { kind: "pan", sx: e.clientX, sy: e.clientY, view: { ...view } };
    return;
  }
  const p = canvasPoint(e);
  let id = hitTest(visibleItems(), p, 8 / view.z)?.id;
  if (tableEditor.isOpen()) {
    if (tool === "select" && id === tableEditor.id() && !e.altKey) {
      if (tableEditor.down(e, p)) drag = { kind: "table-cells" };
      return;
    }
    tableEditor.close();
  }
  if (
    objectLinks.isOpen() &&
    objectLinks.pick(current.items.find((i) => i.id === id))
  )
    return;
  if (tool === "comment") {
    if (!isCommentReadOnly())
      comments.compose(
        p,
        current.items.find((i) => i.id === id),
      );
    return;
  }
  const resize = resizeHit(
    current.items,
    selection,
    p,
    view.z,
    selectionAnchor,
  );
  if (tool === "region") {
    const previousRegion = exportRegion;
    exportRegion = null;
    selection.clear();
    drag = { kind: "region", start: p, previousRegion };
    return;
  }
  if (marquee) {
    startMarquee(p, e, precise);
    toast("Precise selection: enclose at least 90% of each object.");
    draw();
    return;
  }
  if (isSharedReadOnly() && tool !== "select") return;
  const selectedLine =
    tool === "select" &&
    selection.size === 1 &&
    !hasLocked(current.items, selection) &&
    !isSharedReadOnly()
      ? current.items.find((i) => selection.has(i.id) && i.type === "arrow")
      : null;
  const endpoint =
    selectedLine && connectorEndpointHit(selectedLine, p, view.z);
  if (endpoint) {
    drag = {
      kind: "endpoint",
      id: selectedLine.id,
      end: endpoint,
      start: p,
      line: clone(selectedLine),
      original: clone(current.items),
      changed: false,
      gridStep: activeGridStep(),
    };
    lastTap = null;
    return;
  }
  // Locks include the workshop's, as on a board the facilitator froze.
  if (resize && !isSharedReadOnly() && !hasLocked(current.items, selection)) {
    const plan = createResizePlan(
      current.items,
      selection,
      selectionAnchor,
      selectionOptions(),
    );
    drag = {
      kind: "resize",
      groupFocus: focusedGroup,
      plan,
      start: p,
      box: plan.box,
      original: clone(current.items),
      snapIndex: snapIndex(),
      dimensions: showDimensions
        ? createDimensionIndex(
            visibleItems(),
            selection,
            snapViewport(),
            plan.box,
          )
        : null,
      gridStep: activeGridStep(),
      changed: false,
    };
    return;
  }
  if (
    tool === "select" &&
    !isSharedReadOnly() &&
    rotationHit(current.items, selection, p, view.z, e.pointerType === "touch")
  ) {
    const plan = createRotationPlan(
      current.items,
      selection,
      selectionOptions(),
    );
    drag = {
      kind: "rotate",
      groupFocus: focusedGroup,
      plan,
      start: p,
      original: clone(current.items),
      changed: false,
      angle: plan.box.rotation || 0,
    };
    lastTap = null;
    return;
  }
  if (tool === "select") {
    // Inside a selected object's box, where it has nothing drawn, a press
    // still takes that object, so a drag moves it. Shift starts a marquee.
    if (!id && !e.shiftKey)
      id = selectedAt(visibleItems(), selection, p, 4 / view.z)?.id;
    if (id) {
      const linkedItem = current.items.find((i) => i.id === id);
      let link =
        !e.shiftKey &&
        !e.altKey &&
        textLinkHit(linkedItem, canvas.getContext("2d"), p);
      const now = performance.now();
      const doubleClick =
        !e.altKey &&
        !e.shiftKey &&
        lastTap?.id === id &&
        now - lastTap.time < 400;
      if (doubleClick) {
        link = null;
        lastTap = null;
        drag = null;
        if (linkedItem.groupId && focusedGroup !== linkedItem.groupId) {
          selectItems(new Set([id]), { withinGroup: true });
        } else {
          editObject(linkedItem, false, p);
          return;
        }
      } else lastTap = e.altKey ? null : { id, time: now };
      const clickedCell =
        !doubleClick &&
        linkedItem.type === "table" &&
        selection.size === 1 &&
        selection.has(id) &&
        !e.shiftKey &&
        !e.altKey
          ? tableCellAt(linkedItem, p)
          : null;
      if (e.shiftKey) {
        selectionAnchor = null;
        if (focusedGroup && linkedItem.groupId !== focusedGroup) {
          focusedGroup = null;
          selection = descendants(current.items, selection);
        }
        const members = descendants(current.items, new Set([id]), {
          groups: !focusedGroup,
        });
        if (selection.has(id)) members.forEach((id) => selection.delete(id));
        else members.forEach((id) => selection.add(id));
      } else if (
        !selection.has(id) ||
        (linkedItem.mindMap &&
          !e.altKey &&
          selectionAnchor &&
          selectionAnchor !== id) ||
        (hasLocked(current.items, selection) &&
          !hasLocked(current.items, new Set([id])))
      )
        selectItems(new Set([id]), {
          withinGroup: !!focusedGroup && linkedItem.groupId === focusedGroup,
        });
      selection = descendants(current.items, selection, {
        groups: !focusedGroup,
      });
      // Pressing one of several selected objects, such as something in a
      // selected frame, drags them all; a click without moving selects
      // just that one, as a group stays whole.
      const alone = descendants(current.items, new Set([id]), {
        groups: !focusedGroup,
      });
      const narrow = !e.shiftKey &&
        !e.altKey &&
        [...selection].some((other) => !alone.has(other)) && {
          id,
          withinGroup: !!focusedGroup && linkedItem.groupId === focusedGroup,
        };
      if (hasLocked(current.items, selection) || isSharedReadOnly()) {
        drag = link
          ? {
              kind: "link",
              id,
              link,
              linkText: linkedItem.text,
              linkRuns: linkedItem.textRuns,
              start: p,
            }
          : null;
        draw();
        return;
      }
      const moving = current.items
        .filter((i) => selection.has(i.id) && !isConnector(i))
        .map((i) => ({ item: i, x: i.x, y: i.y }));
      drag = {
        kind: "move",
        groupFocus: focusedGroup,
        narrow,
        tableCell: clickedCell,
        link,
        id,
        linkText: linkedItem.text,
        linkRuns: linkedItem.textRuns,
        start: p,
        original: clone(current.items),
        mind:
          !e.altKey && linkedItem.mindMap
            ? createMindDrag(current.items, id, selection)
            : null,
        duplicate: e.altKey
          ? {
              sourceSelection: new Set(selection),
              sourceAnchor: selectionAnchor,
              sourceGroup: focusedGroup,
            }
          : null,
        moving,
        box: moving.length ? bounds(moving.map((entry) => entry.item)) : null,
        snapIndex: snapIndex(),
        gridStep: activeGridStep(),
        active: false,
        changed: false,
      };
    } else {
      startMarquee(p, e);
    }
    draw();
    return;
  }
  if (tool === "arrow" || tool === "pen") {
    const original = clone(current.items),
      previousSelection = new Set(selection);
    const target = tool === "arrow" && !e.altKey ? connectorTarget(p) : null;
    const start =
      tool === "arrow" && !target ? snapGridPoint(p, activeGridStep(e)) : p;
    const i = item(tool, start.x, start.y, {
      w: 0,
      h: 0,
      ...(tool === "pen" ? { points: [[0, 0]] } : {}),
    });
    if (target) i.startId = target.id;
    current.items.push(i);
    inferParents(current.items, new Set([i.id]), {
      skip: facilitation.concealedIds(),
    });
    // A new connector is selected to label or restyle it. Drawing selects
    // nothing, so no selection box or toolbar follows the pencil.
    selection = tool === "pen" ? new Set() : new Set([i.id]);
    drag = {
      kind: tool,
      id: i.id,
      start: p,
      original,
      previousSelection,
      previousAnchor: selectionAnchor,
      previousGroup: focusedGroup,
      line: clone(i),
      changed: false,
      gridStep: activeGridStep(),
    };
    draw();
  } else addObject(tool, p, {}, e);
}
function connectorTarget(p, excluded) {
  return hitTest(
    visibleItems(),
    p,
    8 / view.z,
    (i) => !["arrow", "pen", "frame"].includes(i.type) && i.id !== excluded,
  );
}
function previewMindDrop(e, p) {
  if (!drag?.mind || !drag.active) return;
  const candidate =
    e.ctrlKey || e.metaKey || e.altKey
      ? null
      : mindDragCandidate(current.items, drag.mind, p, view.z);
  if (!candidate) {
    drag.mindPreview = null;
    drag.targetId = null;
    return;
  }
  if (
    drag.mindPreview?.id !== candidate.id ||
    drag.mindPreview?.direction !== candidate.direction
  ) {
    try {
      planMindReparent(
        current,
        drag.mind.id,
        candidate.id,
        candidate.direction,
        { validate: false },
      );
      drag.mindPreview = candidate;
    } catch (error) {
      drag.mindPreview = { ...candidate, error: error.message };
    }
  }
  drag.targetId = drag.mindPreview.error ? null : candidate.id;
}
// The resize corner's cursor points along the diagonal it drags, turned
// with a rotated object.
function resizeCursor(box) {
  const angle = (((45 + (box?.rotation || 0)) % 180) + 180) % 180;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][
    Math.round(angle / 45) % 4
  ];
}
function pointerMove(e) {
  collaborationCursor = canvasPoint(e);
  if (drag?.kind === "table-cells") {
    tableEditor.move(collaborationCursor);
    return;
  }
  if (!drag) {
    if (!tableEditor.isOpen() && tool === "select" && !space) {
      // The corner that resizes takes precedence, as pressing it does.
      const p = collaborationCursor,
        editable = !isSharedReadOnly() && !hasLocked(current.items, selection);
      document.querySelector("#canvas").style.cursor =
        editable &&
        resizeHit(current.items, selection, p, view.z, selectionAnchor)
          ? resizeCursor(
              resizeBounds(current.items, selection, selectionAnchor),
            )
          : !isSharedReadOnly() &&
              rotationHit(current.items, selection, p, view.z)
            ? "grab"
            : "";
    }
    if (tableEditor.isOpen() && tool === "select" && !space)
      document.querySelector("#canvas").style.cursor =
        tableEditor.cursor(collaborationCursor);
    const hit =
      tool === "select" && !space && !editing && mindView.scene().branches.size
        ? hitTest(visibleItems(), collaborationCursor, 8 / view.z)
        : null;
    const next = hit?.mindMap ? hit.id : null;
    if (hoveredMind !== next) {
      hoveredMind = next;
      mindCollapse.render();
    }
    sendPresence();
    return;
  }
  if (
    ["move", "resize", "rotate", "endpoint", "arrow", "marquee"].includes(
      drag.kind,
    )
  )
    drag.pointer = {
      clientX: e.clientX,
      clientY: e.clientY,
      altKey: !!e.altKey,
      shiftKey: !!e.shiftKey,
      ctrlKey: !!e.ctrlKey,
      metaKey: !!e.metaKey,
    };
  const p = canvasPoint(e);
  if (drag.kind === "link") {
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * view.z > 3)
      drag.active = true;
    return;
  }
  if (drag.kind === "pan") {
    view.x = drag.view.x + e.clientX - drag.sx;
    view.y = drag.view.y + e.clientY - drag.sy;
    draw();
    return;
  } else if (drag.kind === "move") {
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * view.z > 3) {
      drag.active = true;
      lastTap = null;
    }
    if (drag.active) {
      if (drag.duplicate && !drag.duplicate.ids) {
        try {
          const plan = planDuplication(current.items, selection, {
            ...selectionOptions(),
            hidden: facilitation.concealedIds(),
            dx: 0,
            dy: 0,
          });
          current.items.push(...plan.copies);
          drag.duplicate.ids = plan.selection;
          drag.duplicate.copies = plan.copies;
          selection = plan.selection;
          focusedGroup = null;
          selectionAnchor = plan.idMap.get(drag.duplicate.sourceAnchor) || null;
          drag.moving = plan.copies
            .filter((i) => !isConnector(i))
            .map((i) => ({ item: i, x: i.x, y: i.y }));
          drag.box = bounds(plan.copies);
          drag.snapIndex = snapIndex();
        } catch (error) {
          toast(error.message);
          return cancelTransform();
        }
      }
      const snapped = snapGridMove(
        drag.box,
        snapMove(
          drag.snapIndex,
          drag.box,
          p.x - drag.start.x,
          p.y - drag.start.y,
          view.z,
          !snapping || e.altKey,
        ),
        e.altKey || e.ctrlKey || e.metaKey ? 0 : drag.gridStep,
      );
      for (const { item: i, x, y } of drag.moving) {
        i.x = x + snapped.dx;
        i.y = y + snapped.dy;
      }
      drag.guides = snapped.guides;
      drag.changed =
        drag.moving.length > 0 &&
        (Math.abs(snapped.dx) > 1e-9 || Math.abs(snapped.dy) > 1e-9);
      previewMindDrop(e, p);
    }
  } else if (drag.kind === "rotate") {
    if (isSharedReadOnly() || hasLocked(current.items, drag.plan.ids))
      return cancelTransform();
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * view.z > 3)
      drag.active = true;
    if (drag.active) {
      const delta = rotationDelta(drag.plan, drag.start, p, e.shiftKey);
      try {
        applyRotation(current.items, drag.plan, delta);
        drag.changed = Math.abs(delta % 360) > 1e-9;
        drag.angle = (drag.plan.box.rotation || 0) + delta;
      } catch (error) {
        toast(error.message);
        return cancelTransform();
      }
    }
  } else if (drag.kind === "resize") {
    const delta = rotatePoint(
      { x: p.x - drag.start.x, y: p.y - drag.start.y },
      { x: 0, y: 0 },
      -(drag.box.rotation || 0),
    );
    const snapped = snapResize(
      drag.snapIndex,
      drag.box,
      drag.box.w + delta.x,
      drag.plan.autoHeight ? drag.box.h : drag.box.h + delta.y,
      view.z,
      !snapping || e.altKey || !!drag.box.rotation,
      {
        ...resizeLimits(drag.plan),
        gridStep:
          e.altKey || e.ctrlKey || e.metaKey || drag.box.rotation
            ? 0
            : drag.gridStep,
        gridY: !drag.plan.autoHeight,
        dimensions: drag.dimensions,
        dimensionY: !drag.plan.autoHeight,
        proportional:
          !drag.plan.autoHeight &&
          (drag.plan.fixedProportions ||
            drag.plan.proportional !== !!e.shiftKey),
      },
    );
    try {
      applyResize(current.items, drag.plan, snapped.w, snapped.h);
      drag.error = null;
      drag.guides = drag.plan.autoHeight
        ? snapped.guides.filter((g) => g.axis === "x")
        : snapped.guides;
      drag.changed =
        Math.abs(snapped.w - drag.box.w) > 1e-9 ||
        (!drag.plan.autoHeight && Math.abs(snapped.h - drag.box.h) > 1e-9);
    } catch (error) {
      if (drag.error !== error.message) toast(error.message);
      drag.error = error.message;
      drag.guides = [];
    }
  } else if (["arrow", "endpoint"].includes(drag.kind)) {
    const i = current.items.find((i) => i.id === drag.id);
    if (!i || isSharedReadOnly() || hasLocked(current.items, new Set([i.id])))
      return cancelTransform();
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * view.z > 3)
      drag.active = true;
    if (drag.active) {
      const geometry = ["x", "y", "w", "h", "startId", "endId", "routeAxis"];
      for (const key of geometry) {
        if (Object.hasOwn(drag.line, key)) i[key] = drag.line[key];
        else delete i[key];
      }
      const end = drag.end || "end";
      const fixed =
        end === "start" ? { x: i.x + i.w, y: i.y + i.h } : { x: i.x, y: i.y };
      let point = p;
      const target = e.altKey
        ? null
        : connectorTarget(p, i[end === "start" ? "endId" : "startId"]);
      if (e.shiftKey && !target) {
        const angle =
          (Math.round(
            Math.atan2(p.y - fixed.y, p.x - fixed.x) / (Math.PI / 4),
          ) *
            Math.PI) /
          4;
        const length = Math.hypot(p.x - fixed.x, p.y - fixed.y);
        point = {
          x: fixed.x + Math.cos(angle) * length,
          y: fixed.y + Math.sin(angle) * length,
        };
      } else if (!target && !e.altKey && !e.ctrlKey && !e.metaKey) {
        point = snapGridPoint(point, drag.gridStep);
      }
      setConnectorEnd(i, end, point, target);
      updateConnectors(current.items);
      drag.targetId = target?.id;
      drag.changed = geometry.some((key) => i[key] !== drag.line[key]);
    }
  } else if (drag.kind === "marquee" || drag.kind === "region") {
    const a = {
      x: Math.min(p.x, drag.start.x),
      y: Math.min(p.y, drag.start.y),
      w: Math.abs(p.x - drag.start.x),
      h: Math.abs(p.y - drag.start.y),
    };
    if (drag.kind !== "region") {
      updateMarqueeSelection(a, e.shiftKey);
      a.precise = drag.precise;
    }
    drag.marquee = a;
    draw();
    return;
  } else {
    const i = current.items.find((i) => i.id === drag.id);
    i.w = p.x - drag.start.x;
    i.h = p.y - drag.start.y;
    if (
      drag.kind === "pen" &&
      !extendDrawing(i.points, i.w, i.h, view.z) &&
      !drag.full
    ) {
      drag.full = true;
      toast("This drawing is full. Draw again to continue.");
    }
  }
  updateConnectors(current.items);
  if (drag.duplicate?.copies) {
    try {
      checkDuplicateGeometry(drag.duplicate.copies);
    } catch (error) {
      toast(error.message);
      return cancelTransform();
    }
  }
  sendPresence();
  draw();
}
function pointerUp(event) {
  if (!drag) return;
  if (drag.kind === "rotate" && event?.type === "pointerup") {
    pointerMove(event);
    if (!drag) return;
  }
  if (drag.kind === "marquee" && (event?.type === "pointerup" || drag.pointer))
    pointerMove(event?.type === "pointerup" ? event : drag.pointer);
  if (drag.kind === "table-cells") {
    tableEditor.end();
    drag = null;
    return;
  }
  if (drag.mind && drag.active) {
    if (
      event?.type !== "pointerup" ||
      isSharedReadOnly() ||
      !validMindDrag(current.items, drag.mind) ||
      hasLocked(current.items, selection)
    )
      return cancelTransform();
    pointerMove(event);
    if (!drag) return;
    if (drag.mindPreview) {
      try {
        const { id, direction } = drag.mindPreview;
        const plan = planMindReparent(current, drag.mind.id, id, direction);
        const byId = new Map(current.items.map((i) => [i.id, i]));
        for (const patch of plan.patch) {
          const node = byId.get(patch.id);
          node.x = patch.x;
          node.y = patch.y;
          if (patch.order !== undefined) node.order = patch.order;
          node.mindMap = { ...patch.mindMap };
          if (patch.mindCollapsed !== undefined)
            node.mindCollapsed = patch.mindCollapsed;
        }
        mindView.invalidate();
        drag.mindReparented = plan.patch.length > 0;
        drag.changed ||= drag.mindReparented;
      } catch (error) {
        toast(error.message);
        return cancelTransform();
      }
    }
  }
  const clickedCell =
    event?.type === "pointerup" && !drag.active && drag.tableCell;
  const narrowTo =
    event?.type === "pointerup" &&
    drag.kind === "move" &&
    !drag.active &&
    !drag.duplicate &&
    drag.narrow;
  const clickedTable =
    clickedCell && current.items.find((i) => i.id === drag.id);
  if (
    drag.duplicate &&
    (!drag.changed || isSharedReadOnly() || current.items.length > 5000)
  )
    return cancelTransform();
  const linkedItem = drag.link && current.items.find((i) => i.id === drag.id);
  const clickedLink =
    event?.type === "pointerup" &&
    !drag.active &&
    linkedItem?.text === drag.linkText &&
    linkedItem?.textRuns === drag.linkRuns
      ? drag.link
      : null;
  if (drag.kind === "region") {
    const region = drag.marquee;
    // A tap selects no region: keep the previous one.
    if (!region || region.w * view.z < 3 || region.h * view.z < 3)
      return cancelTransform();
    exportRegion = region;
    drag = null;
    setTool("select");
    toast("Region selected. Open Export to use it.");
    return;
  }
  const createdLine =
    drag.kind === "arrow" && current.items.find((i) => i.id === drag.id);
  if (
    drag.kind === "arrow" &&
    (!createdLine ||
      !drag.changed ||
      Math.hypot(createdLine.w, createdLine.h) * view.z < 3)
  ) {
    cancelTransform();
    return;
  }
  if (
    isSharedReadOnly() &&
    ["move", "resize", "rotate", "endpoint", "arrow", "pen"].includes(drag.kind)
  )
    return cancelTransform();
  if (
    (["move", "resize", "rotate", "endpoint", "arrow"].includes(drag.kind) &&
      drag.changed) ||
    drag.kind === "pen"
  ) {
    checkpoint("Board edit", {
      ...clone(current),
      items: clone(drag.original),
    });
    if (!collaboration) history.push(undoState(drag.original));
  }
  if (["arrow", "pen"].includes(drag.kind) || drag.changed) {
    if (drag.kind === "pen") {
      const i = current.items.find((i) => i.id === drag.id);
      const xs = i.points.map((p) => p[0]),
        ys = i.points.map((p) => p[1]);
      const minX = Math.min(...xs),
        minY = Math.min(...ys);
      i.points = i.points.map((p) => [p[0] - minX, p[1] - minY]);
      i.x += minX;
      i.y += minY;
      i.w = Math.max(...xs) - minX;
      i.h = Math.max(...ys) - minY;
    }
    // A new drawing or line belongs to the frame its middle is in, as a
    // moved object does, not the one it was started in.
    if (["arrow", "pen"].includes(drag.kind))
      inferParents(current.items, new Set([drag.id]), {
        skip: facilitation.concealedIds(),
      });
    if (["move", "resize", "rotate"].includes(drag.kind)) {
      const moved = selection;
      const skip = facilitation.concealedIds();
      if (drag.duplicate) placeDuplicates(current.items, moved, skip);
      else inferMovedParents(current.items, drag.plan?.ids || moved, { skip });
      planning.syncStatus(planning.parents(drag.original));
    }
    if (drag.original && !drag.mindReparented)
      preserveManualMindMoves(drag.original, current.items);
    autoLayoutMindMaps(current.items);
    updateConnectors(current.items);
    save();
    presenceSettling = Date.now() + 2000;
  }
  if (drag.kind === "marquee")
    selection = unlockedSelection(current.items, selection);
  const movedBranch = drag.mindReparented
    ? bounds(
        current.items.filter(
          (i) => i.id === drag.mind.id || i.id === drag.mindPreview.id,
        ),
      )
    : null;
  drag = null;
  if (narrowTo && current.items.some((i) => i.id === narrowTo.id))
    selectItems(new Set([narrowTo.id]), { withinGroup: narrowTo.withinGroup });
  sendPresence();
  if (movedBranch) revealQuickObject(movedBranch, { minimal: true });
  else draw();
  if (clickedTable) tableEditor.open(clickedTable, clickedCell);
  if (clickedLink) {
    const rect = document.querySelector("#canvas").getBoundingClientRect();
    textLinkPreview.show(linkedItem, clickedLink, {
      x: event.clientX - rect.left + 12,
      y: event.clientY - rect.top + 12,
    });
  }
}
function fit() {
  attention.stop();
  const a = bounds(visibleItems()),
    r = document.querySelector("#canvas").getBoundingClientRect();
  view.z = Math.max(
    0.15,
    Math.min(
      1.25,
      Math.min(
        (r.width - (r.width < 760 ? 32 : 160)) / (a.w + 80),
        (r.height - 180) / (a.h + 80),
      ),
    ),
  );
  view.x = r.width / 2 - (a.x + a.w / 2) * view.z;
  view.y = r.height / 2 - (a.y + a.h / 2) * view.z;
  draw();
}
function modal(title, content, onReady) {
  canvasNavigation.finish();
  minimap.cancel();
  const previous = document.activeElement;
  const d = document.createElement("dialog");
  d.setAttribute("aria-label", title);
  d.innerHTML = `<div class="dialog-header"><h2>${title}</h2><button class="icon-btn" aria-label="Close dialog">${icon("x")}</button></div>${content}`;
  document.body.append(d);
  d.querySelector(".dialog-header button").onclick = () => d.close();
  d.addEventListener("close", () => {
    const restoreFocus =
      document.activeElement === document.body ||
      d.contains(document.activeElement);
    d.remove();
    if (restoreFocus) {
      if (previous?.isConnected) previous.focus();
      else document.querySelector("#canvas")?.focus();
    }
  });
  d.addEventListener("click", (e) => {
    if (
      e.target === d &&
      (e.clientX < d.getBoundingClientRect().left ||
        e.clientX > d.getBoundingClientRect().right ||
        e.clientY < d.getBoundingClientRect().top ||
        e.clientY > d.getBoundingClientRect().bottom)
    )
      d.close();
  });
  d.showModal();
  iconsRefresh();
  onReady?.(d);
  translateUI(d);
  return d;
}
function rotateSelectionDialog() {
  if (!canEditSelection()) return;
  const plan = createRotationPlan(current.items, selection, selectionOptions());
  if (!plan)
    return toast("Select shapes, text, images, cards, or drawings to rotate.");
  const target = current,
    signatureOptions = { groups: !focusedGroup },
    signature = rotationSignature(current.items, plan.ids, signatureOptions);
  const single = plan.items.length === 1,
    initial = single ? rotationOf(plan.items[0]) : 0,
    displayed = String(Math.round(initial * 1000) / 1000);
  modal(
    "Rotate selection",
    `<form>
    <label class="field">${single ? "Angle (degrees)" : "Rotate by (degrees)"}<input id="rotation-angle" type="number" step="any" value="${displayed}" aria-describedby="rotation-error" required></label>
    <div class="dialog-footer"><button type="button" class="secondary" data-turn="-90">−90°</button><button type="button" class="secondary" data-turn="90">+90°</button>${single ? '<button type="button" class="secondary" id="rotation-reset">Reset angle</button>' : ""}</div>
    <p class="dialog-copy">Drag the rotation handle below the left corner. Hold Shift to snap to 15° steps. Escape cancels.</p>
    <p id="rotation-error" class="dialog-copy" role="alert" hidden></p>
    <div class="dialog-footer"><button class="primary" type="submit">Apply rotation</button></div></form>`,
    (d) => {
      const input = d.querySelector("#rotation-angle"),
        errorMessage = d.querySelector("#rotation-error");
      const clearError = () => {
        errorMessage.textContent = "";
        errorMessage.hidden = true;
        input.removeAttribute("aria-invalid");
      };
      let edited = false;
      input.oninput = () => {
        edited = true;
        clearError();
      };
      for (const button of d.querySelectorAll("[data-turn]"))
        button.onclick = () => {
          input.value =
            (input.value === displayed ? initial : +input.value || 0) +
            +button.dataset.turn;
          edited = true;
          clearError();
        };
      const reset = d.querySelector("#rotation-reset");
      if (reset)
        reset.onclick = () => {
          input.value = 0;
          edited = true;
          clearError();
        };
      input.focus();
      input.select();
      d.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        clearError();
        if (!d.querySelector("form").reportValidity()) return;
        if (
          current !== target ||
          signature !==
            rotationSignature(current.items, plan.ids, signatureOptions)
        ) {
          d.close();
          return toast("The selection changed. Select it again.");
        }
        if (!canEditSelection(plan.ids)) return;
        const delta =
          !edited && input.value === displayed ? 0 : +input.value - initial;
        try {
          applyRotation(clone(current.items), plan, delta);
          if (Math.abs(delta % 360) > 1e-9)
            mutate(() => {
              applyRotation(current.items, plan, delta);
              inferMovedParents(current.items, plan.ids, {
                skip: facilitation.concealedIds(),
              });
            });
          d.close();
        } catch (error) {
          errorMessage.textContent = t(error.message);
          errorMessage.hidden = false;
          input.setAttribute("aria-invalid", "true");
          input.focus();
        }
      };
    },
  );
}
function exactRegionDialog() {
  if (!current) return;
  const target = current,
    canvas = document.querySelector("#canvas"),
    size = canvas.getBoundingClientRect(),
    region = exportRegion || {
      x: Math.max(-1e6, Math.min(1e6, -view.x / view.z)),
      y: Math.max(-1e6, Math.min(1e6, -view.y / view.z)),
      w: Math.max(2, Math.min(1e6, (size.width || 1200) / view.z)),
      h: Math.max(2, Math.min(1e6, (size.height || 900) / view.z)),
    };
  modal(
    "Set export region",
    `<form id="region-form"><p class="dialog-copy" id="region-help">Enter the top-left position and size of the export region in board pixels.</p><div class="field-row"><label class="field">Horizontal position<input id="region-x" type="number" step="any" min="-1000000" max="1000000" value="${region.x}" required aria-describedby="region-help"></label><label class="field">Vertical position<input id="region-y" type="number" step="any" min="-1000000" max="1000000" value="${region.y}" required aria-describedby="region-help"></label></div><div class="field-row"><label class="field">Width<input id="region-width" type="number" step="any" min="2" max="1000000" value="${region.w}" required aria-describedby="region-help"></label><label class="field">Height<input id="region-height" type="number" step="any" min="2" max="1000000" value="${region.h}" required aria-describedby="region-help"></label></div><div class="dialog-footer"><button class="primary" type="submit">Use region</button></div></form>`,
    (d) => {
      d.querySelector("#region-x").focus();
      d.querySelector("#region-x").select();
      d.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        if (!d.querySelector("form").reportValidity()) return;
        if (current !== target) return d.close();
        exportRegion = {
          x: d.querySelector("#region-x").valueAsNumber,
          y: d.querySelector("#region-y").valueAsNumber,
          w: d.querySelector("#region-width").valueAsNumber,
          h: d.querySelector("#region-height").valueAsNumber,
        };
        selection.clear();
        setTool("select");
        d.close();
        draw();
        toast("Region selected. Open Export to use it.");
      };
    },
  );
}
function moveSelectionDialog() {
  if (!selection.size) return toast("Select objects first.");
  if (!canEditSelection()) return;
  const target = current,
    ids = new Set(selection),
    options = selectionOptions(),
    expanded = descendants(current.items, ids, options);
  if (!current.items.some((i) => expanded.has(i.id) && !isConnector(i)))
    return toast("Select objects that can be moved.");
  const selected = [...ids].sort().join(),
    signature = rotationSignature(current.items, ids, options);
  modal(
    "Move selection",
    `<form><p class="dialog-copy" id="move-help">Move the selection and its contents by a distance in board pixels. Positive values move right or down; negative values move left or up.</p><div class="field-row"><label class="field">Horizontal distance<input id="move-x" type="number" step="any" min="-2000000" max="2000000" value="0" aria-describedby="move-help move-error" required></label><label class="field">Vertical distance<input id="move-y" type="number" step="any" min="-2000000" max="2000000" value="0" aria-describedby="move-help move-error" required></label></div><p id="move-error" role="alert" hidden></p><div class="dialog-footer"><button class="primary" type="submit">Apply move</button></div></form>`,
    (d) => {
      const x = d.querySelector("#move-x"),
        y = d.querySelector("#move-y");
      x.focus();
      x.select();
      d.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        if (!d.querySelector("form").reportValidity()) return;
        if (
          current !== target ||
          [...selection].sort().join() !== selected ||
          rotationSignature(current.items, ids, options) !== signature
        ) {
          d.close();
          return toast("The selection changed. Select it again.");
        }
        if (!canEditSelection(ids)) return;
        const dx = x.valueAsNumber,
          dy = y.valueAsNumber;
        // Check the complete move before recording history or changing a
        // frame, its contents, or connectors attached to the selection.
        const trial = clone(current.items);
        moveItems(trial, ids, dx, dy, options);
        if (
          trial.some((i) =>
            [i.x, i.y, i.w, i.h].some(
              (n) => !Number.isFinite(n) || Math.abs(n) > 1e6,
            ),
          )
        ) {
          const error = d.querySelector("#move-error");
          error.textContent = t(
            "Move exceeds the board limits. Enter a smaller distance.",
          );
          error.hidden = false;
          return;
        }
        if (dx || dy)
          mutate(() => {
            moveItems(current.items, ids, dx, dy, options);
            inferMovedParents(current.items, ids, {
              skip: facilitation.concealedIds(),
            });
          });
        d.close();
      };
    },
  );
}
function resizeSelectionDialog() {
  if (!canEditSelection()) return;
  const plan = createResizePlan(
    current.items,
    selection,
    selectionAnchor,
    selectionOptions(),
  );
  if (!plan) return toast("Select objects with a resizable area.");
  const target = current,
    signatureOptions = { groups: !focusedGroup },
    signature = rotationSignature(current.items, plan.ids, signatureOptions);
  const round = (n) => Math.round(n * 1000) / 1000;
  modal(
    plan.frameOnly ? "Resize frame" : "Resize selection",
    `<form>
    <p class="dialog-copy">${plan.autoHeight ? "Height adjusts to the text. Change the width to rewrap it." : plan.frameOnly ? "Frame contents stay in place." : "Resize objects and their spacing together."}</p>
    <div class="field-row"><label class="field">Width<input id="resize-width" type="number" min="0.001" step="any" value="${round(plan.box.w)}" aria-describedby="resize-feedback" required></label>
    <label class="field">Height<input id="resize-height" type="number" min="0.001" step="any" value="${round(plan.box.h)}" aria-describedby="resize-feedback" ${plan.autoHeight ? "readonly" : "required"}></label></div>
    <label class="resize-option" ${plan.autoHeight ? "hidden" : ""}><input id="resize-proportions" type="checkbox" ${plan.proportional ? "checked" : ""} ${plan.fixedProportions ? "disabled" : ""}>Keep proportions</label>
    ${plan.scaleText ? '<label class="resize-option"><input id="resize-text" type="checkbox" checked>Scale text with objects</label>' : ""}
    <p class="dialog-copy">${plan.autoHeight ? "Drag the corner horizontally to change text width. Alt/Option bypasses snapping." : plan.fixedProportions ? "Rotated selections keep their proportions. Alt/Option bypasses snapping." : "Drag the corner to resize. Shift toggles proportions; Alt/Option bypasses snapping."}</p>
    <p id="resize-feedback" class="dialog-copy" role="alert" hidden></p>
    <div class="dialog-footer"><button class="primary" type="submit">Apply size</button></div></form>`,
    (d) => {
      const width = d.querySelector("#resize-width"),
        height = d.querySelector("#resize-height"),
        proportions = d.querySelector("#resize-proportions"),
        feedback = d.querySelector("#resize-feedback"),
        form = d.querySelector("form");
      const clearFeedback = () => {
        feedback.textContent = "";
        feedback.hidden = true;
      };
      const showFeedback = (message) => {
        feedback.textContent = t(message);
        feedback.hidden = false;
      };
      form.addEventListener("input", clearFeedback);
      form.addEventListener("change", clearFeedback);
      let axis = "w";
      const sync = (from) => {
        axis = from;
        if (plan.autoHeight) {
          if (+width.value > 0)
            height.value = autoHeightLayout(
              { ...plan.items[0], w: +width.value },
              document.querySelector("#canvas").getContext("2d"),
            ).height;
          return;
        }
        if (!proportions.checked) return;
        if (from === "w" && +width.value > 0)
          height.value = round((+width.value * plan.box.h) / plan.box.w);
        else if (from === "h" && +height.value > 0)
          width.value = round((+height.value * plan.box.w) / plan.box.h);
      };
      width.oninput = () => sync("w");
      height.oninput = () => sync("h");
      proportions.onchange = () => sync(axis);
      width.focus();
      width.select();
      form.onsubmit = (e) => {
        e.preventDefault();
        clearFeedback();
        if (!form.reportValidity()) return;
        if (
          current !== target ||
          signature !==
            rotationSignature(current.items, plan.ids, signatureOptions)
        ) {
          d.close();
          return toast("The selection changed. Select it again.");
        }
        if (!canEditSelection(plan.ids)) return;
        const scaleText = d.querySelector("#resize-text")?.checked || false;
        let w = +width.value,
          h = plan.autoHeight ? plan.box.h : +height.value;
        if (proportions.checked) {
          if (axis === "w") h = (w * plan.box.h) / plan.box.w;
          else w = (h * plan.box.w) / plan.box.h;
        }
        const size = snapResize({ x: [], y: [] }, plan.box, w, h, 1, true, {
          ...resizeLimits(plan, scaleText),
          proportional: proportions.checked,
        });
        if (Math.abs(size.w - w) > 0.001 || Math.abs(size.h - h) > 0.001) {
          width.value = round(size.w);
          height.value = round(size.h);
          return showFeedback(
            "Size adjusted to keep content readable. Review and apply again.",
          );
        }
        try {
          if (
            Math.abs(size.w - plan.box.w) > 1e-9 ||
            Math.abs(size.h - plan.box.h) > 1e-9
          ) {
            // Validate against a detached copy before recording an undo step.
            applyResize(clone(current.items), plan, size.w, size.h, scaleText);
            mutate(() => {
              applyResize(current.items, plan, size.w, size.h, scaleText);
              inferMovedParents(current.items, plan.ids, {
                skip: facilitation.concealedIds(),
              });
            });
          }
          d.close();
        } catch (error) {
          showFeedback(error.message);
        }
      };
    },
  );
}
function resizeBy(factor) {
  pointerUp();
  if (!canEditSelection()) return;
  const plan = createResizePlan(
    current.items,
    selection,
    selectionAnchor,
    selectionOptions(),
  );
  if (!plan) return;
  const size = snapResize(
    { x: [], y: [] },
    plan.box,
    plan.box.w * factor,
    plan.autoHeight ? plan.box.h : plan.box.h * factor,
    1,
    true,
    { ...resizeLimits(plan), proportional: !plan.autoHeight },
  );
  if (
    Math.abs(size.w - plan.box.w) < 1e-9 &&
    Math.abs(size.h - plan.box.h) < 1e-9
  )
    return;
  try {
    applyResize(clone(current.items), plan, size.w, size.h);
    mutate(() => {
      applyResize(current.items, plan, size.w, size.h);
      inferMovedParents(current.items, plan.ids, {
        skip: facilitation.concealedIds(),
      });
    });
  } catch (error) {
    toast(error.message);
  }
}
function connectionEndpoints(i) {
  if (!i || i.type !== "arrow" || !canEditSelection(new Set([i.id]))) return;
  const board = current,
    signature = (line) =>
      JSON.stringify([
        line.x,
        line.y,
        line.w,
        line.h,
        line.startId || "",
        line.endId || "",
      ]),
    opened = signature(i);
  // Objects the workshop hides from this person are neither named nor
  // offered; an end already attached to one keeps it, unnamed.
  const concealed = facilitation.concealedIds();
  const nodes = current.items.filter(
    (n) => !["arrow", "pen", "frame"].includes(n.type) && !concealed.has(n.id),
  );
  const shown = new Set(nodes.map((n) => n.id));
  const endpoint = (end, label) => {
    const attached = i[`${end}Id`];
    const choice = (value, title, checked) =>
      `<label><input type="radio" name="connection-${end}" value="${escape(value)}" aria-describedby="connection-error" ${checked ? "checked" : ""}><span>${title}</span></label>`;
    const hidden =
      attached && !shown.has(attached)
        ? choice(attached, t("Hidden object"), true)
        : "";
    const node = nodes.find((n) => n.id === attached),
      title = node
        ? objectNameHTML(node, 100)
        : t(attached ? "Hidden object" : "Free endpoint");
    const point = concealed.has(attached)
      ? { x: 0, y: 0 }
      : end === "start"
        ? { x: i.x, y: i.y }
        : { x: i.x + i.w, y: i.y + i.h };
    return `<fieldset id="connection-${end}" class="connection-choices"><legend>${label}</legend><details><summary>${title}</summary><div class="slide-choices">${choice("", t("Free endpoint"), !attached)}${hidden}${nodes.map((node) => choice(node.id, objectNameHTML(node, 100), attached === node.id)).join("")}</div></details></fieldset><div id="connection-${end}-position" hidden><div class="field-row">${["x", "y"].map((axis) => `<label class="field">${t(`${end === "start" ? "Start" : "End"} ${axis === "x" ? "horizontal" : "vertical"} position`)}<input id="connection-${end}-${axis}" type="number" step="any" min="-2000000" max="2000000" value="${point[axis]}" required aria-describedby="connection-help connection-error"></label>`).join("")}</div></div>`;
  };
  modal(
    "Connection endpoints",
    `<form><p class="dialog-copy" id="connection-help">Choose an object for each end, or select Free endpoint and enter its position in board pixels.</p>${endpoint("start", "Start object")}${endpoint("end", "End object")}<p id="connection-error" role="alert" hidden></p><div class="dialog-footer"><button class="primary" type="submit">Save changes</button></div></form>`,
    (d) => {
      const form = d.querySelector("form"),
        error = d.querySelector("#connection-error");
      const clearError = () => {
        error.textContent = "";
        error.hidden = true;
        for (const input of form.querySelectorAll('[aria-invalid="true"]'))
          input.removeAttribute("aria-invalid");
      };
      const showChoiceError = (message, ends) => {
        error.textContent = t(message);
        error.hidden = false;
        for (const end of ends)
          d.querySelector(`#connection-${end} input:checked`).setAttribute(
            "aria-invalid",
            "true",
          );
        d.querySelector(`#connection-${ends[0]} details`).open = true;
        d.querySelector(`#connection-${ends[0]} input:checked`).focus();
      };
      form.addEventListener("input", clearError);
      form.addEventListener("change", clearError);
      const sync = () => {
        for (const end of ["start", "end"]) {
          const attached = !!d.querySelector(`#connection-${end} input:checked`)
            .value;
          d.querySelector(`#connection-${end}-position`).hidden = attached;
          for (const input of d.querySelectorAll(
            `#connection-${end}-position input`,
          ))
            input.disabled = attached;
        }
      };
      for (const end of ["start", "end"]) {
        const choices = d.querySelector(`#connection-${end}`);
        choices.onchange = () => {
          const selected = choices.querySelector("input:checked");
          choices.querySelector("summary").innerHTML = selected
            .closest("label")
            .querySelector("span").innerHTML;
          sync();
        };
      }
      sync();
      form.onsubmit = (e) => {
        e.preventDefault();
        clearError();
        const target = current?.items.find((line) => line.id === i.id);
        if (
          current !== board ||
          !target ||
          target.type !== "arrow" ||
          signature(target) !== opened
        )
          return toast("This object changed. Open it again to edit it.");
        if (!canEditSelection(new Set([target.id]))) return;
        sync();
        if (!form.reportValidity()) return;
        const start = d.querySelector("#connection-start input:checked").value,
          end = d.querySelector("#connection-end input:checked").value;
        if (start && start === end)
          return showChoiceError("Choose two different objects.", [
            "end",
            "start",
          ]);
        // Only an end already attached may stay on an object now hidden.
        const hidden = facilitation.concealedIds();
        const unavailable = ["start", "end"].filter((edge) => {
          const attached = edge === "start" ? start : end;
          return (
            attached &&
            ((attached !== target[`${edge}Id`] && hidden.has(attached)) ||
              !current.items.some((node) => node.id === attached))
          );
        });
        if (unavailable.length)
          return showChoiceError("Choose a visible object.", unavailable);
        const point = (end, attached) =>
          attached
            ? end === "start"
              ? { x: target.x, y: target.y }
              : { x: target.x + target.w, y: target.y + target.h }
            : {
                x: d.querySelector(`#connection-${end}-x`).valueAsNumber,
                y: d.querySelector(`#connection-${end}-y`).valueAsNumber,
              };
        const a = point("start", start),
          b = point("end", end);
        if (
          (target.startId || "") === start &&
          (target.endId || "") === end &&
          a.x === target.x &&
          a.y === target.y &&
          b.x === target.x + target.w &&
          b.y === target.y + target.h
        )
          return d.close();
        const trial = clone(current.items),
          line = trial.find((line) => line.id === target.id);
        Object.assign(line, {
          x: a.x,
          y: a.y,
          w: b.x - a.x,
          h: b.y - a.y,
          startId: start || undefined,
          endId: end || undefined,
        });
        updateConnectors(trial);
        if (
          ![line.x, line.y, line.w, line.h].every(
            (value) => Number.isFinite(value) && Math.abs(value) <= 1e6,
          )
        ) {
          const error = d.querySelector("#connection-error");
          error.hidden = false;
          error.textContent = t(
            "The endpoints exceed the board limits. Choose closer positions.",
          );
          return;
        }
        if (signature(line) !== signature(target))
          mutate(() => {
            Object.assign(target, {
              x: line.x,
              y: line.y,
              w: line.w,
              h: line.h,
            });
            if (start) target.startId = start;
            else delete target.startId;
            if (end) target.endId = end;
            else delete target.endId;
          });
        d.close();
      };
    },
  );
}
function editObject(i, properties = false, point) {
  pointerUp();
  if (i && contentTools.edit(i, properties)) return;
  if (!properties && i?.type === "table") {
    if (!focusedGroup) selectItems(new Set([i.id]));
    return tableEditor.open(
      i,
      point ? tableCellAt(i, point, true) : undefined,
      !!point,
    );
  }
  if (!i || !canEditSelection(new Set([i.id]))) return;
  if (!properties && canEditText(i)) return beginTextEdit(i);
  if (!properties && i.type === "image") return imageCrop.open(i);
  if (i.type === "arrow") return connectionEndpoints(i);
  if (features.edit(i)) return;
  if (i.type === "pen") {
    return altText.open(i);
  }
  // Match resize limits so existing large or small objects remain editable.
  const minimum = (size, limit) =>
    Math.max(1, Math.min(limit, Math.floor(Math.abs(size))));
  const width = Math.round(i.w),
    height = Math.round(i.h);
  modal(
    editTitle(i),
    `<form id="edit-form" aria-describedby="object-error"><div class="field"><span id="object-text-label">Text</span><div id="object-text"></div></div>${i.type === "image" ? `<label class="field">${t("Alternative text")}<textarea id="object-alt"${languageAttribute(i.lang)} rows="3" maxlength="1000" aria-describedby="object-alt-hint object-error">${escape(i.alt || "")}</textarea><small id="object-alt-hint">${t("Read by screen readers. Leave empty for decorative images. The command palette's Alternative text can suggest one with AI.")}</small></label>` : ""}<div class="field-row"><label class="field">Width<input id="object-width" aria-describedby="object-error" type="number" min="${minimum(i.w, 60)}" max="1000000" value="${width}" required></label><label class="field">Height<input id="object-height" aria-describedby="object-error" type="number" min="${minimum(i.h, i.type === "text" ? 1 : 45)}" max="1000000" value="${height}" ${growsWithText(i) ? "readonly" : "required"}></label></div>${growsWithText(i) ? '<p class="dialog-copy">Height adjusts to the text. Change the width to rewrap it.</p>' : ""}<p id="object-error" class="dialog-copy" role="alert" tabindex="-1" hidden></p><div class="dialog-footer"><button class="primary" type="submit">Save changes</button></div></form>`,
    (d) => {
      const form = d.querySelector("form"),
        error = d.querySelector("#object-error");
      const clearError = () => {
        error.textContent = "";
        error.hidden = true;
      };
      const showConflict = () => {
        error.textContent = t("This object changed. Open it again to edit it.");
        error.hidden = false;
        error.focus();
      };
      form.addEventListener("input", clearError);
      form.addEventListener("change", clearError);
      const field = createTextEditor(document, i, { plainTextOnly: true });
      field.id = "object-text";
      field.className = "authored-text-field";
      field.tabIndex = 0;
      field.dataset.userContent = "";
      field.setAttribute("aria-labelledby", "object-text-label");
      field.setAttribute("aria-describedby", "object-error");
      d.querySelector("#object-text").replaceWith(field);
      d.addEventListener("close", () => field.destroy(), { once: true });
      field.focus();
      const openedText = i.text || "",
        openedAlt = i.alt || "",
        openedRuns = clone(i.textRuns || []),
        openedLanguage = i.lang;
      form.onsubmit = (e) => {
        e.preventDefault();
        clearError();
        // A collaborator may have removed, locked, or rewritten the object
        // while the dialog was open. Only fields changed here are saved,
        // and never over someone else's newer words.
        if (!current.items.includes(i)) return showConflict();
        if (!canEditSelection(new Set([i.id]))) return;
        const text = field.value,
          alt = d.querySelector("#object-alt")?.value.trim();
        const textChanged = text !== openedText,
          altChanged = alt !== undefined && alt !== openedAlt;
        if (
          (textChanged &&
            ((i.text || "") !== openedText ||
              i.lang !== openedLanguage ||
              !equalTextRuns(i.textRuns, openedRuns))) ||
          (altChanged && (i.alt || "") !== openedAlt)
        )
          return showConflict();
        mutate(() => {
          if (textChanged) {
            const runs = clone(field.textRuns);
            const blocks = replacedBlocks(i, text);
            if (blocks.length) i.textBlocks = blocks;
            else delete i.textBlocks;
            if (runs.length) i.textRuns = runs;
            else delete i.textRuns;
            i.text = text;
          }
          if (altChanged) {
            if (alt) i.alt = alt;
            else delete i.alt;
          }
          // Untouched fields keep their exact size instead of rounding it.
          const nextWidth = +d.querySelector("#object-width").value,
            nextHeight = +d.querySelector("#object-height").value;
          if (nextWidth !== width) i.w = nextWidth;
          if (!growsWithText(i) && nextHeight !== height) i.h = nextHeight;
        });
        d.close();
      };
    },
  );
}
function download(data, name, type) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([data], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fileInput(accept, callback, { multiple = false } = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = multiple;
  input.onchange = () =>
    input.files[0] &&
    callback(multiple ? Array.from(input.files) : input.files[0]);
  input.click();
}
function titleWithSuffix(title, suffix) {
  let end = Math.min(title.length, Math.max(0, 200 - suffix.length));
  const last = title.charCodeAt(end - 1), next = title.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  return title.slice(0, end) + suffix;
}

async function importBoard(file) {
  try {
    if (file.size > 100 * 1024 * 1024)
      throw Error("Choose a file smaller than 100 MB.");
    let b;
    // What exactly is wrong inside a file means nothing to the person
    // importing it, and the parser's wording is not translated.
    try {
      b = validateBoard(JSON.parse(await file.text()));
    } catch {
      throw Error("This is not a supported Whiteboard file.");
    }
    assertImagePixels(b.items);
    b.id = uid();
    delete b.shared;
    delete b.timer;
    b.workshop = portableWorkshop(b.workshop);
    if (!b.workshop) delete b.workshop;
    // Library state from another device must not place the board in Trash
    // or inject markup through unvalidated fields.
    delete b.deletedAt;
    b.favorite = b.favorite === true;
    b.updated = Date.now();
    // Titles are limited to 200 characters, including the suffix.
    const imported = ` (${t("imported")})`;
    b.title = titleWithSuffix(b.title, imported);
    boards.push(b);
    await local.save(b);
    openBoard(b);
    toast("Board imported.");
  } catch (e) {
    toast(
      e instanceof DOMException
        ? "Could not import this file."
        : e.message || "Could not import this file.",
    );
  }
}
function imageInput() {
  const target = current,
    canvas = document.querySelector("#canvas"),
    point = center();
  fileInput(
    "image/png,image/jpeg,image/webp",
    (files) => {
      if (current === target && canvas.isConnected)
        transfer.addFiles(files, point, { imagesOnly: true });
    },
    { multiple: true },
  );
}

async function leaveCollaboration() {
  collaborationAttempt++;
  const session = collaboration;
  if (session) {
    await collaborationEdits;
    await session.queue;
    if (session.recoveryFailed && session.unsaved) {
      toast("Local recovery failed. Keep this tab open.");
      return false;
    }
    // Edits still waiting for their batch are sent now, briefly, so others
    // get them without this person opening the board again.
    if (session.pending.size && session.connected && !session.readOnly)
      await Promise.race([
        session.flush().catch(() => {}),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    // What could not be sent waits on this device for the board to be
    // opened again; closing the tab meanwhile warns.
    if (session.unsaved) unsentBoards.set(session.room, session);
    else unsentBoards.delete(session.room);
    await session.finishView();
    attention.reset();
    collaboration = null;
    session.close();
  }
  collaborationBusy = false;
  collaborationRendered = collaborationLastSaved = null;
  collaborationPeople = new Map();
  collaborationRoster = [];
  boardMembers = [];
  if (collaborationFrame) cancelAnimationFrame(collaborationFrame);
  collaborationFrame = null;
  collaborationHadPreview = false;
  presenceLayer?.close();
  presenceLayer = null;
}
function sendPresence() {
  if (!collaboration) return;
  presenceSelection = sharedSelectionKey();
  // What a facilitator types or draws where participants cannot see it,
  // such as in a hidden or staged frame, is not sent to them live either.
  const secret = editing && facilitation.unseen(editing.item);
  collaboration.presence({
    cursor: collaborationCursor,
    settling: Date.now() < presenceSettling,
    selection: sharedSelection(),
    editing: (!secret && editing?.item.id) || null,
    text: secret ? null : (editing?.input.value.slice(0, 20000) ?? null),
    preview:
      drag &&
      ["move", "resize", "rotate", "pen", "arrow", "endpoint"].includes(
        drag.kind,
      )
        ? current.items
            .filter(
              (i) =>
                (selection.has(i.id) ||
                  (drag.kind === "pen" && i.id === drag.id)) &&
                !facilitation.unseen(i),
            )
            .slice(0, 100)
            .map(({ id, type, color, points, x, y, w, h, rotation }) => ({
              id,
              x,
              y,
              w,
              h,
              rotation: rotation || 0,
              // A move or rotation leaves a drawing's own points as they
              // were, so only creating or resizing one sends them.
              ...(["pen", "arrow"].includes(type) &&
              ["pen", "arrow", "endpoint", "resize"].includes(drag.kind)
                ? {
                    type,
                    color,
                    points: points?.filter(
                      (_, index) =>
                        index % Math.max(1, Math.ceil(points.length / 256)) ===
                        0,
                    ),
                  }
                : {}),
            }))
        : [],
  });
}
// Whether this person may invite and change roles: a role refused since,
// as after being removed, grants nothing.
const managesBoard = (session) =>
  !!session && !session.denied && canManage(session.role);
const accessKey = () =>
  collaboration ? `${collaboration.role}:${!!collaboration.denied}` : "";
function renderParticipants() {
  const button = document.querySelector(".participants");
  if (!button) return;
  button.hidden = !collaboration;
  if (collaboration) {
    // The roster has an entry per open tab; count each person once.
    const people = new Map(collaborationRoster.map((p) => [p.user, p]));
    // This runs for every cursor frame; unchanged text is left as it is.
    const text = `${people.size || 1} · ${t("Participants")}`,
      names = [...people.values()].map((p) => p.username).join(", ");
    if (button.textContent !== text) button.textContent = text;
    if (button.title !== names) button.title = names;
  }
  const shareDialog = document
    .querySelector("dialog[open] #share-link")
    ?.closest("dialog");
  if (shareDialog?.showAccess && shareDialog.shareRole !== accessKey())
    shareDialog.showAccess();
  const participants = document
    .querySelector("dialog[open] #participant-list")
    ?.closest("dialog");
  if (participants?.refreshAccess && participants.accessRole !== accessKey())
    participants.refreshAccess();
  const readOnly = isSharedReadOnly(),
    canComment = !isCommentReadOnly();
  const editor = document.querySelector(".editor");
  // Losing edit access closes the text being typed and any creation tool,
  // which could no longer save anything. Connecting is only briefly
  // read-only and leaves them.
  if (
    readOnly &&
    !collaborationBusy &&
    editor &&
    !editor.classList.contains("shared-viewer")
  ) {
    if (editing) finishTextEdit();
    if (
      !["select", "hand", "region"].includes(tool) &&
      !(tool === "comment" && canComment)
    ) {
      tool = "select";
      showTool();
    }
  }
  editor?.classList.toggle("shared-viewer", readOnly);
  editor?.classList.toggle("shared-commenter", readOnly && canComment);
  const title = document.querySelector("#board-title");
  if (title) title.disabled = readOnly;
  for (const button of document.querySelectorAll(
    '[data-action^="tool-"], [data-action="shapes"]',
  ))
    button.disabled =
      readOnly &&
      !["tool-select", "tool-hand"].includes(button.dataset.action) &&
      !(button.dataset.action === "tool-comment" && canComment);
}
// The board's members, offered for @mentions. Fetched on joining and again
// whenever comments open, so people who joined since can be mentioned; a
// failed fetch keeps the list from before.
function refreshBoardMembers() {
  const session = collaboration;
  if (!session || session.closed || !session.connected) return;
  session
    .request("members")
    .then(({ members }) => {
      if (collaboration === session) boardMembers = members;
    })
    .catch(() => {});
}
async function startCollaboration(target, token, localTimer) {
  if (collaboration) {
    if ((await leaveCollaboration()) === false)
      throw Error(t("Local recovery failed. Keep this tab open."));
    // Reconnecting keeps the board open, so the live cursors and follow
    // controls that leaving removed come back.
    const wrap = current === target && document.querySelector(".canvas-wrap");
    if (wrap) {
      presenceLayer = new PresenceLayer(wrap);
      attention.bind(wrap);
    }
  }
  const attempt = ++collaborationAttempt;
  // Opening it again sends what was left.
  unsentBoards.delete(target.shared.room);
  collaborationBusy = true;
  renderParticipants();
  status("Connecting to shared board…");
  try {
    await connect();
    const user = await window.puter.auth.getUser();
    if (current !== target || attempt !== collaborationAttempt) return;
    const session = new CollaborationSession({
      puter: window.puter,
      ...target.shared,
      user,
      changed: (board) => {
        if (collaboration !== session || current !== target) return;
        const before = collaborationRendered;
        const next = before ? rebase(target, before, board) : board;
        if (collaborationLastSaved && before)
          collaborationLastSaved = rebase(
            collaborationLastSaved,
            before,
            board,
          );
        else collaborationLastSaved = clone(next);
        collaborationRendered = clone(board);
        target.title = next.title;
        target.tags = next.tags;
        target.timer = next.timer;
        target.planning = next.planning;
        if (next.workshop) target.workshop = next.workshop;
        else delete target.workshop;
        if (next.comments) target.comments = next.comments;
        const existing = new Map(target.items.map((item) => [item.id, item]));
        target.items = next.items.map((item) => {
          const previous = existing.get(item.id);
          if (!previous) return item;
          if (
            JSON.stringify(previous.textRuns) ===
              JSON.stringify(item.textRuns) &&
            item.textRuns
          )
            item.textRuns = previous.textRuns;
          if (
            JSON.stringify(previous.textBlocks) ===
              JSON.stringify(item.textBlocks) &&
            item.textBlocks
          )
            item.textBlocks = previous.textBlocks;
          for (const key of Object.keys(previous))
            if (!(key in item)) delete previous[key];
          return Object.assign(previous, item);
        });
        target.updated = Date.now();
        // Remembered so a copy made from the library, while the board is
        // closed, keeps what this person may see as a facilitator.
        if (target.shared) target.shared.role = session.role;
        if (editing) {
          const item = target.items.find((i) => i.id === editing.item.id);
          // Locked meanwhile, by someone or a facilitator's lock: typing
          // stops, after what was typed until now reaches the others.
          const locked = item && hasLocked(target.items, new Set([item.id]));
          if (item && !locked) editing.item = item;
          else {
            const focused = editing.input.contains(document.activeElement);
            editing.unbind?.();
            editing.input.destroy();
            editing.input.remove();
            editing.hint.remove();
            editing = null;
            sendPresence();
            if (focused)
              document.querySelector("#canvas")?.focus({ preventScroll: true });
            if (locked)
              toast(
                facilitation.frozen() ||
                  "Someone locked this object while you were editing it.",
              );
          }
        }
        if (drag?.original && before) {
          drag.original = rebase(
            { ...target, items: drag.original },
            before,
            board,
          ).items;
          // A replacement source and its crop must not be combined with a
          // geometry draft made against the previous source.
          const movingIds =
            drag.duplicate?.sourceSelection || drag.plan?.ids || selection;
          const oldImages = new Map(
            before.items
              .filter((i) => movingIds.has(i.id) && i.type === "image")
              .map((i) => [i.id, i.src]),
          );
          // An image arriving from the server is the same source.
          const arrived = (before, after) =>
            before?.startsWith("asset:") &&
            session.assetIds.get(after) === before.slice(6);
          if (
            board.items.some(
              (i) =>
                oldImages.has(i.id) &&
                oldImages.get(i.id) !== i.src &&
                !arrived(oldImages.get(i.id), i.src),
            )
          )
            cancelTransform();
          if (drag?.groupFocus) {
            const ids =
              drag.duplicate?.sourceSelection || drag.plan?.ids || selection;
            const oldMembers = before.items.filter((i) => ids.has(i.id));
            const nextById = new Map(board.items.map((i) => [i.id, i]));
            if (
              isSharedReadOnly() ||
              hasLocked(target.items, ids) ||
              oldMembers.some((i) => {
                const next = nextById.get(i.id);
                return (
                  !next ||
                  ["groupId", "parentId", "x", "y", "w", "h", "rotation"].some(
                    (key) => i[key] !== next[key],
                  )
                );
              })
            )
              cancelTransform();
          }
          if (
            drag?.kind === "rotate" &&
            (isSharedReadOnly() ||
              hasLocked(target.items, drag.plan.ids) ||
              rotationSignature(before.items, drag.plan.ids, {
                groups: !drag.groupFocus,
              }) !==
                rotationSignature(board.items, drag.plan.ids, {
                  groups: !drag.groupFocus,
                }))
          )
            cancelTransform();
          const hidden = mindView.scene().hidden;
          if (
            (drag?.id && hidden.has(drag.id)) ||
            [...selection].some(
              (id) => hidden.has(id) && !selection.has(hidden.get(id)),
            )
          )
            cancelTransform();
          if (
            drag?.mind &&
            (!validMindDrag(drag.original, drag.mind, true) ||
              isSharedReadOnly() ||
              hasLocked(target.items, selection) ||
              (drag.mindPreview &&
                !target.items.some((i) => i.id === drag.mindPreview.id)))
          )
            cancelTransform();
          if (drag?.moving) {
            const byId = new Map(target.items.map((i) => [i.id, i]));
            for (const entry of drag.moving)
              entry.item = byId.get(entry.item.id);
            // Restore every moved object, not only the removed one.
            if (drag.moving.some((e) => !e.item)) cancelTransform();
          }
          if (drag?.duplicate) {
            const present = new Set(target.items.map((i) => i.id));
            if (
              isSharedReadOnly() ||
              target.items.length > 5000 ||
              hasLocked(target.items, drag.duplicate.sourceSelection) ||
              [...drag.duplicate.sourceSelection].some((id) => !present.has(id))
            )
              cancelTransform();
          }
          if (drag?.mind) {
            drag.mindPreview = null;
            if (drag.pointer)
              previewMindDrop(drag.pointer, canvasPoint(drag.pointer));
          }
          if (drag?.dimensions) {
            drag.dimensions = createDimensionIndex(
              visibleItems(),
              selection,
              snapViewport(),
              drag.plan.box,
            );
            drag.guides = [];
          }
        }
        const present = new Set(target.items.map((i) => i.id));
        selection = new Set([...selection].filter((id) => present.has(id)));
        updateConnectors(target.items);
        if (drag?.kind === "marquee") {
          drag.index = null;
          drag.baseSelection = new Set(
            [...drag.baseSelection].filter((id) => present.has(id)),
          );
          if (drag.marquee)
            updateMarqueeSelection(drag.marquee, drag.pointer?.shiftKey);
        }
        const title = document.querySelector("#board-title");
        if (title && document.activeElement !== title)
          title.value = target.title;
        document.title = target.title + " · Whiteboard";
        boardSearch.refresh();
        // Unfinished gestures are previews; save their rebased originals.
        const persisted = clone(
          drag?.original ? { ...target, items: drag.original } : target,
        );
        saveChain = saveChain
          .catch(() => {})
          .then(() => local.save(persisted))
          .catch(() =>
            toast("Could not save locally. Export your board to keep a copy."),
          );
        renderParticipants();
        draw();
      },
      viewChanged: (views, roster) => {
        if (collaboration === session && current === target)
          attention.update(views, roster);
      },
      attention: (person) => {
        // A participant of a locked workshop board cannot move the others.
        if (
          collaboration === session &&
          current === target &&
          !facilitation.lockedFor(person.role)
        )
          attention.receive(person);
      },
      activity: (people, roster) => {
        if (collaboration !== session || current !== target) return;
        collaborationPeople = people;
        collaborationRoster = roster;
        if (!collaborationFrame)
          collaborationFrame = requestAnimationFrame(() => {
            collaborationFrame = null;
            if (collaboration !== session || current !== target) return;
            const preview = [...collaborationPeople.values()].some(
              (p) =>
                (p.preview?.length || p.text !== null) &&
                Date.now() - p.at < 2500,
            );
            // Viewers and commenters are both read-only for content, but
            // only commenters get the comment controls.
            const classes = document.querySelector(".editor")?.classList;
            const accessChanged =
              classes?.contains("shared-viewer") !== isSharedReadOnly() ||
              classes?.contains("shared-commenter") !==
                (isSharedReadOnly() && !isCommentReadOnly());
            renderParticipants();
            if (preview || collaborationHadPreview || accessChanged) draw();
            else
              presenceLayer?.render(
                facilitation.people(collaborationPeople),
                visibleItems(),
                view,
                session.session,
                attention.showCursors(),
              );
            collaborationHadPreview = preview;
          });
      },
      status: (message) => {
        if (collaboration === session && current === target) status(message);
      },
      rejected: () => {
        if (collaboration !== session || current !== target) return;
        // Recovery replaced the shared document; bind the open editor to it.
        if (editing?.unbind) {
          editing.unbind();
          // The editor shows the shared text again, without the refused
          // words, rather than saving them once more.
          editing.unbind = bindText(
            session,
            editing.item.id,
            editing.input,
            editing.sharedChange,
            { reload: true },
          );
        }
        toast(
          "Some changes could not be saved because they conflicted with the shared board.",
        );
      },
    });
    collaboration = session;
    collaborationScopes.set(target, session.scope);
    // Check the account's own deployment independently of joining: an old or
    // broken worker must not have to accept a join before it can be updated.
    refreshDeployment(window.puter, session.server).catch(() => {
      if (collaboration === session && !session.closed)
        toast("Sharing update could not finish. Reopen this board to retry.");
    });
    boardMembers = [];
    await session.start(token);
    if (collaboration !== session) return;
    refreshBoardMembers();
    if (localTimer?.state === "running" && target.timer?.id === localTimer.id) {
      const remaining = Math.round(timerRemaining(localTimer, Date.now()));
      session.shared.setTimer({
        ...localTimer,
        remaining,
        endsAt: Math.round(session.now() + remaining),
      });
      await session.publish();
      await session.queue;
      await session.flush();
    }
    if (collaboration !== session || current !== target) return;
    collaborationBusy = false;
    // Images the first render could not download may have arrived since;
    // they reach the board the way any other change does, so the board and
    // what it was last rendered from agree.
    await session.publish();
    if (collaboration !== session || current !== target) return;
    collaborationLastSaved = clone(target);
    renderParticipants();
    draw();
    return session;
  } catch (error) {
    if (current === target) {
      collaborationBusy = false;
      if (collaboration) {
        collaboration.readOnly = true;
        collaboration.contentReadOnly = true;
        collaboration.failure(error);
      }

      renderParticipants();
      status("Could not connect · local copy available");
    }
    throw error;
  }
}
// Sharing sets up a server, uploads the board, and connects, which can take
// several seconds. A dialog says so at once and names each step; closing it
// lets the work finish in the background.
let sharing = null;
function shareProgress(target) {
  const state = {
    target,
    text: t("Setting up sharing…"),
    dialog: null,
    dismissed: false,
    done: false,
  };
  state.show = () => {
    state.dismissed = false;
    state.dialog = modal(
      "Share board",
      `<div class="share-progress"><span class="spinner" aria-hidden="true"></span><p id="share-progress-text" role="status"></p></div><p class="dialog-copy">${t("This can take a few seconds. You can close this and keep working.")}</p>`,
      (d) => (d.querySelector("#share-progress-text").textContent = state.text),
    );
    state.dialog.addEventListener("close", () => {
      if (!state.done) state.dismissed = true;
    });
  };
  state.step = (text) => {
    state.text = t(text);
    const line = state.dialog?.querySelector("#share-progress-text");
    if (line) line.textContent = state.text;
  };
  state.finish = () => {
    state.done = true;
    if (state.dialog?.open) state.dialog.close();
  };
  return state;
}
async function shareBoard() {
  const target = current;
  if (!target) return;
  // Pressing Share again while it is being set up shows the progress again.
  if (sharing && !sharing.done) {
    if (sharing.target !== target)
      return toast(
        "Another board is still being shared. Try again in a moment.",
      );
    if (!sharing.dialog?.open) sharing.show();
    return;
  }
  if (collaborationBusy)
    return toast(
      "Still connecting to the shared board. Try again in a moment.",
    );
  let progress = null;
  try {
    pointerUp();
    finishTextEdit();
    if (!target.shared) {
      collaborationBusy = true;
      renderParticipants();
      await connect();
      // After signing in, which may open Puter's own window.
      progress = sharing = shareProgress(target);
      progress.show();
      const user = await window.puter.auth.getUser();
      // Members create shared boards on their organization's worker, where
      // its policies, directory, and audit log apply.
      const server =
        organization.server && organization.isMember
          ? organization.server
          : await deploy(window.puter, (message) => {
              if (current === target) status(message);
              progress.step(message);
            });
      const room = uid();
      const staging = new CollaborationSession({
        puter: window.puter,
        server,
        room,
        user,
        changed() {},
        activity() {},
        status,
      });
      const seed = new SharedDocument();
      progress.step("Uploading the board…");
      try {
        const prepared = await staging.prepare(target);
        for (const thread of prepared.comments || [])
          for (const message of thread.messages)
            if (message.authorId === commentIdentity) {
              message.authorId = user.uuid;
              message.authorName = user.username || "Member";
            }
        if (prepared.workshop)
          prepared.workshop = adoptWorkshop(
            prepared.workshop,
            commentIdentity,
            user,
            "Local author",
          );
        seed.commit(prepared);
        await staging.request("create", { update: encode(seed.update()) });
        try {
          await staging.uploadAssets();
        } catch (error) {
          // Without its files the shared copy cannot be used, and trying
          // again creates another, so this one goes to the trash.
          await staging.request("delete").catch(() => {});
          throw error;
        }
        if (prepared.comments) target.comments = prepared.comments;
        if (prepared.workshop) target.workshop = prepared.workshop;
        target.tags = prepared.tags;
      } finally {
        seed.destroy();
        staging.shared.destroy();
      }
      target.shared = { server, room };
      await local.save(target);
      clearTimeout(cloudTimer);
      pendingCloud.delete(target.id);
      await cloud.save(target);
      if (current !== target) return;
      progress.step("Connecting to shared board…");
      await startCollaboration(
        target,
        undefined,
        target.timer && clone(target.timer),
      );
      const tag = document.querySelector(".board-tag");
      if (tag) tag.textContent = t("Shared board");
    } else if (!collaboration?.connected || collaboration.closed) {
      await connect();
      progress = sharing = shareProgress(target);
      progress.show();
      progress.step("Connecting to shared board…");
      await startCollaboration(target);
    }
    if (current !== target || !collaboration) return;
    const linkedId = boardDestination(location.href, location.href)?.objectId;
    window.history.replaceState(
      window.history.state,
      "",
      objectAddress(target, linkedId, location.href),
    );
    draw();
    const session = collaboration;
    progress?.finish();
    // Closed while it was being set up: say it is ready rather than open
    // a dialog the person did not ask for just now.
    if (progress?.dismissed)
      return toast("Sharing is ready. Select Share board to invite people.");
    modal(
      "Share board",
      `<p class="dialog-copy">${t("Invite people to edit, comment on, or view this board. Invitations expire after seven days.")}</p><label class="field">${t("Link access")}<select id="share-role">${boardAccess.roleOptions(collaboration.role === "facilitator" ? "facilitator" : "owner")}</select></label>${boardAccess.shareControls()}<button class="primary" id="create-invite">${t("Create invitation")}</button><label class="field">${t("Board link")}<input id="share-link" readonly aria-label="${t("Board link")}"></label><div class="dialog-footer"><button class="secondary" id="board-settings-open">${icon("settings")}${t("Board settings")}</button><button class="secondary" id="copy-share">${t("Copy link")}</button><button class="secondary" id="revoke-invites">${t("Revoke invitation links")}</button></div><p id="share-message" role="status"></p>`,
      (d) => {
        const field = d.querySelector("#share-link"),
          message = d.querySelector("#share-message");
        let invitation;
        const scope = d.querySelector("#share-scope");
        const showLink = () =>
          (field.value = sectionLink(
            shareLink(session.server, session.room, invitation),
            scope?.value,
          ));
        showLink();
        scope?.addEventListener("change", showLink);
        // An invitation grants the access chosen when it was created, so
        // choosing other access withdraws its link rather than copying it.
        const accessChanged = () => {
          if (!invitation) return;
          invitation = undefined;
          showLink();
          message.textContent = t("Create an invitation to share this access.");
        };
        d.querySelector("#share-role").addEventListener(
          "change",
          accessChanged,
        );
        d.querySelector("#share-guest")?.addEventListener(
          "change",
          accessChanged,
        );
        d.querySelector("#board-settings-open").onclick = () => {
          d.close();
          boardAccess.settings();
        };
        // Everyone can copy the board link; only managers invite. A role
        // changed by someone else while this is open updates the controls.
        const showAccess = () => {
          const manager = managesBoard(session),
            role = d.querySelector("#share-role"),
            chosen = role.value;
          d.shareRole = accessKey();
          role.innerHTML = boardAccess.roleOptions(
            session.role === "facilitator" ? "facilitator" : "owner",
          );
          if ([...role.options].some((o) => o.value === chosen))
            role.value = chosen;
          d.querySelector("#board-settings-open").hidden = !manager;
          for (const control of d.querySelectorAll(
            "#share-role, #share-guest, #create-invite",
          ))
            control.disabled = !manager;
          d.querySelector("#revoke-invites").hidden = !manager;
          const refused = t(
            "Only the owner or a facilitator can invite new participants.",
          );
          if (!manager) message.textContent = refused;
          else if (message.textContent === refused) message.textContent = "";
        };
        d.showAccess = showAccess;
        showAccess();
        d.querySelector("#create-invite").onclick = async (e) => {
          const done = busy(e.currentTarget);
          try {
            const { token } = await session.request("invite", {
              role: d.querySelector("#share-role").value,
              guest: !!d.querySelector("#share-guest")?.checked,
            });
            invitation = token;
            showLink();
            field.select();
            message.textContent = t(
              "Anyone signed in with this invitation can join.",
            );
          } catch (error) {
            message.textContent = t(error.message);
            return done();
          }
          // The platform prompts only when a cross-user event grant is
          // actually needed. The invitation works either way, so a failure
          // here keeps its message.
          try {
            const joined = await session.request("join");
            if (joined.app && window.puter.perms?.request) {
              window.puter.perms
                .request(`manage:kv-share:${joined.owner}:${joined.app}:wb`)
                .catch(() => {});
            }
          } catch {
            /* Live updates fall back to periodic synchronization. */
          } finally {
            done();
          }
        };
        d.querySelector("#copy-share").onclick = async () => {
          try {
            await navigator.clipboard.writeText(field.value);
            message.textContent = t("Link copied.");
          } catch {
            field.focus();
            field.select();
            message.textContent = t("Copy the selected link.");
          }
        };
        d.querySelector("#revoke-invites").onclick = async () => {
          try {
            await session.request("revoke-invite");
            invitation = undefined;
            showLink();
            message.textContent = t(
              "Invitation links revoked. Existing members retain access.",
            );
          } catch (error) {
            message.textContent = t(error.message);
          }
        };
      },
    );
  } catch (error) {
    progress?.finish();
    if (current === target && !collaboration)
      status("Sharing failed · try again");
    toast(error.message || "Could not connect to Puter.");
  } finally {
    progress?.finish();
    if (sharing === progress) sharing = null;
    if (current === target) {
      collaborationBusy = false;
      renderParticipants();
    }
  }
}
// Open a shared board by its worker and room, creating the local entry the
// first time. Organization boards, invitations, and notifications use this.
async function openShared(server, room, { token, objectId, thread } = {}) {
  await connect();
  if ((await leaveCollaboration()) === false)
    throw Error(t("Local recovery failed. Keep this tab open."));
  const same = (b) => b.shared?.server === server && b.shared?.room === room;
  let target = boards.find(same);
  // Another tab may have joined it since this one read the library; its
  // entry, and what that tab keeps for it on this device, are used as they
  // are, rather than a second entry being made and cleared on a failure.
  if (!target) {
    target = (await local.list()).find((b) => same(b) && !b.deletedAt);
    if (target && !boards.some((b) => b.id === target.id)) boards.push(target);
  }
  const created = !target;
  if (created) {
    target = board(t("Shared board"));
    target.shared = { server, room };
    boards.push(target);
  }
  current = target;
  // Reset per-board state as openBoard does.
  exportRegion = null;
  selection.clear();
  history = new History();
  tool = "select";
  view = { x: 110, y: 85, z: 1 };
  status.board = null;
  editor();
  try {
    await startCollaboration(target, token);
  } catch (error) {
    // A board this browser could not join has no local copy to show, so
    // its empty placeholder leaves the library again.
    if (
      created &&
      current === target &&
      (!collaboration || collaboration.closed)
    ) {
      boards.splice(boards.indexOf(target), 1);
      forgetJoin(target);
      await home();
    }
    throw error;
  }
  // Left before it connected: there is nothing more to open, and a board
  // this browser had not joined before leaves the library again.
  if (current !== target) {
    if (created && boards.includes(target)) {
      boards.splice(boards.indexOf(target), 1);
      refreshLibrary();
      forgetJoin(target);
    }
    return target;
  }
  await local.save(target);
  fit();
  window.history.replaceState(
    null,
    "",
    objectId
      ? objectAddress(target, objectId, location.href)
      : shareLink(server, room),
  );
  if (objectId) focusLinkedObject(objectId, false);
  if (thread && current === target) comments.show(thread);
  return target;
}
// A board this browser joined for the first time and did not keep: its
// first synchronization may already have saved it on this device, with its
// images and files.
function forgetJoin(target) {
  const scope = collaborationScopes.get(target);
  saveChain = saveChain
    .catch(() => {})
    .then(() => local.remove(target.id))
    .then(() => scope && local.collaborationClear(scope))
    .catch(() => {});
}
function joinDialog(link = "") {
  modal(
    "Join shared board",
    `<form><label class="field">${t("Board link")}<input id="join-link" type="url" required value="${escape(link)}" placeholder="https://…" aria-label="${t("Board link")}"></label><p class="dialog-copy">${t("Sign in with Puter to join this board.")}</p><p id="join-error" role="status"></p><div class="dialog-footer"><button class="primary" type="submit">${t("Join board")}</button></div></form>`,
    (d) => {
      d.querySelector("form").onsubmit = async (event) => {
        event.preventDefault();
        const done = busy(d.querySelector('[type="submit"]'));
        try {
          const inputURL = new URL(
            d.querySelector("#join-link").value,
            location.href,
          ).href;
          const { server, room, token } = parseLink(inputURL);
          const objectId = boardDestination(inputURL, inputURL)?.objectId;
          await openShared(server, room, { token, objectId });
          d.close();
        } catch (error) {
          d.querySelector("#join-error").textContent = t(error.message);
        } finally {
          done();
        }
      };
    },
  );
}
function participantsDialog() {
  const session = collaboration;
  if (!session) return;
  modal(
    "Participants",
    '<div id="participant-list" class="participant-list"></div>',
    async (d) => {
      attention.mountDialog(d);
      const list = d.querySelector("#participant-list");
      const heading = document.createElement("h3");
      heading.textContent = t("Board access");
      list.before(heading);
      try {
        const { members } = await session.request("members");
        if (collaboration === session) boardMembers = members;
        const rows = [],
          pending = new Set();
        // Choices follow this person's own role, which can change while
        // the dialog is open.
        const fill = (select, member) => {
          const focused = document.activeElement === select;
          select.replaceChildren();
          for (const role of member.role === "owner"
            ? ["owner"]
            : [
                ...new Set([
                  member.role,
                  ...assignableRoles(session.role),
                  "removed",
                ]),
              ]) {
            const option = document.createElement("option");
            option.value = role;
            option.textContent = t(ROLE_LABELS[role]);
            select.append(option);
          }
          select.value = member.role;
          select.disabled =
            !managesBoard(session) ||
            member.role === "owner" ||
            (session.role !== "owner" && member.role === "facilitator");
          if (focused && select.disabled) d.querySelector("button")?.focus();
        };
        d.refreshAccess = () => {
          d.accessRole = accessKey();
          for (const [select, member] of rows)
            if (!pending.has(select)) fill(select, member);
        };
        d.accessRole = accessKey();
        for (const member of members) {
          const row = document.createElement("div");
          row.className = "participant-row";
          const name = document.createElement("span");
          name.className = "participant-name";
          name.textContent = member.username || member.uuid;
          name.style.borderColor = participantColor(member.uuid);
          row.append(name);
          const select = document.createElement("select");
          select.setAttribute(
            "aria-label",
            t("Access for") + " " + name.textContent,
          );
          if (member.guest) {
            const badge = document.createElement("span");
            badge.className = "badge";
            badge.textContent = t("Guest");
            row.append(badge);
          }
          fill(select, member);
          rows.push([select, member]);
          select.onchange = async () => {
            const done = busy(select);
            pending.add(select);
            try {
              await session.request("role", {
                uuid: member.uuid,
                role: select.value,
              });
              member.role = select.value;
              await session.heartbeat();
            } catch (error) {
              select.value = member.role;
              toast(error.message);
            } finally {
              done();
              pending.delete(select);
              fill(select, member);
            }
          };
          row.append(select);
          list.append(row);
        }
      } catch (error) {
        // The list itself is not announced as it loads, which would read
        // out every member; only a failure is.
        const message = document.createElement("p");
        message.className = "dialog-copy";
        message.setAttribute("role", "alert");
        message.textContent = t(error.message);
        list.replaceChildren(message);
      }
    },
  );
}
async function connect() {
  if (!window.puter)
    throw Error("Puter could not load. Check your connection and try again.");
  if (!window.puter.auth.isSignedIn()) {
    // Closing Puter's sign-in window rejects with a plain object, which
    // would show no message at all.
    await window.puter.auth.signIn().catch((error) => {
      throw error instanceof Error
        ? error
        : Error("Sign in with Puter to continue.");
    });
    // Someone who signs in now gets their organization's policies, such as
    // its AI settings, just as if they had been signed in on arrival.
    await reconnectOrganization().catch(() => {});
  }
  cloud ??= new CloudStore(window.puter);
  return cloud;
}
// Reconnect to a remembered or site-configured organization quietly.
async function reconnectOrganization() {
  if (organization.info) return;
  const found = await organization.discover();
  if (!found || readOrganizationLink(location.href)) return;
  if (!window.puter?.auth?.isSignedIn?.()) return;
  await organization.use(found.server);
  if (!current) home({ keepAddress: true });
}
async function cloudSave() {
  if (collaboration) {
    await collaborationEdits;
    return collaboration.flush().catch((e) => {
      collaboration.failure(e);
      toast(e.message);
    });
  }
  try {
    await connect();
    cloudIds.add(current.id);
    await sync(clone(current));
  } catch (e) {
    toast(e.message || "Could not connect to Puter.");
  }
}
function cloudDialog() {
  modal(
    "Your Puter cloud",
    `<p class="dialog-copy">Keep boards in your own Puter drive. Connect to open a cloud board, or save a board from its canvas.</p><button class="primary" id="connect-cloud">${icon("cloud")}Connect to Puter</button><div id="cloud-list" class="cloud-list" aria-live="polite"></div>`,
    (d) => {
      d.querySelector("#connect-cloud").onclick = async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const list = d.querySelector("#cloud-list");
        list.textContent = t("Loading your boards…");
        try {
          await connect();
          const files = await cloud.list();
          list.innerHTML = files.length
            ? `<p>${t("Select a file to open its latest saved version.")}</p>`
            : "";
          if (!files.length)
            list.textContent = t(
              "No cloud boards yet. Open a board and choose Save to Puter.",
            );
          for (const f of files) {
            const btn = document.createElement("button");
            btn.className = "cloud-file";
            btn.textContent = f.title || f.name;
            btn.onclick = async () => {
              btn.disabled = true;
              try {
                const b = await cloud.read(f.path || `whiteboard/${f.name}`);
                const existing = boards.find((x) => x.id === b.id);
                if (existing && existing.updated > b.updated) {
                  toast("A newer local copy was kept.");
                  cloudIds.add(existing.id);
                  d.close();
                  openBoard(existing);
                  return;
                }
                b.id = f.name.slice(0, -5);
                const index = boards.findIndex((x) => x.id === b.id);
                if (index >= 0) boards[index] = b;
                else boards.push(b);
                await local.save(b);
                cloudIds.add(b.id);
                d.close();
                openBoard(b);
              } catch (e) {
                toast(e.message || "Could not open cloud board.");
                btn.disabled = false;
              }
            };
            list.append(btn);
          }
          if (window.puter.env !== "app") {
            const out = document.createElement("button");
            out.textContent = t("Disconnect Puter");
            out.className = "text-btn";
            out.onclick = async () => {
              clearTimeout(cloudTimer);
              await cloud.queue.catch(() => {});
              window.puter.auth.signOut();
              cloud = null;
              cloudIds.clear();
              pendingCloud.clear();
              // The organization belonged to that account; the next person
              // to sign in finds their own.
              organization.reset();
              d.close();
              if (!current) home({ keepAddress: true });
              toast("Disconnected. Your local boards are still available.");
            };
            list.append(out);
          }
        } catch (e) {
          list.textContent = t(
            e.message || "Could not connect. Please try again.",
          );
        } finally {
          btn.disabled = false;
        }
      };
    },
  );
}
function boardOptions(b) {
  if (b.deletedAt) {
    modal(
      "Trash",
      `<p data-user-content>${escape(b.title)}</p><button class="primary" id="restore-board">Restore board</button>`,
      (d) =>
        (d.querySelector("#restore-board").onclick = async () => {
          delete b.deletedAt;
          await local.save(b);
          d.close();
          home();
          toast("Board restored.");
        }),
    );
    return;
  }
  modal(
    "Board options",
    `<label class="field">Board name<input id="rename" maxlength="200" value="${escape(b.title)}"></label><div class="dialog-footer"><button class="text-btn danger" id="remove-board">Delete local board</button><button class="secondary" id="copy-board">Duplicate</button><button class="primary" id="rename-board">Save name</button></div>`,
    (d) => {
      if (b.shared) {
        d.querySelector("#rename").readOnly = true;
        d.querySelector("#rename-board").textContent = t("Open to rename");
      }
      d.querySelector("#rename-board").onclick = async () => {
        if (b.shared) {
          d.close();
          await openBoard(b);
          document.querySelector("#board-title")?.focus();
          return;
        }
        b.title =
          d.querySelector("#rename").value.trim() || t("Untitled board");
        b.updated = Date.now();
        await local.save(b);
        d.close();
        home();
      };
      d.querySelector("#copy-board").onclick = async (e) => {
        // One copy per press: a double click must not make two.
        const button = e.currentTarget;
        if (button.disabled) return;
        button.disabled = true;
        const copy = clone(b);
        copy.id = uid();
        delete copy.timer;
        // A shared board's copy leaves out what this person may not see
        // there, judged by the role they last had on it.
        const covered = facilitation.portableCopy(
          copy,
          b.shared
            ? {
                id: await window.puter?.auth
                  ?.getUser?.()
                  .then((u) => u?.uuid)
                  .catch(() => null),
                manager: canManage(b.shared.role),
              }
            : { id: commentIdentity, manager: true },
        );
        delete copy.shared;
        const suffix = ` (${t("copy")})`;
        copy.title = titleWithSuffix(copy.title, suffix);
        copy.updated = Date.now();
        boards.push(copy);
        try {
          await local.save(copy);
        } catch {
          boards.splice(boards.indexOf(copy), 1);
          button.disabled = false;
          return toast("Could not save the copy on this device.");
        }
        d.close();
        home();
        if (covered)
          toast("Workshop content hidden from you was left out of the copy.");
      };
      d.querySelector("#remove-board").onclick = () => {
        d.close();
        modal(
          "Delete this local board?",
          `<p class="dialog-copy">${t("Deleted boards can be restored here.")} <span data-user-content>${escape(b.title)}</span></p><div class="dialog-footer"><button class="secondary" id="cancel-delete">Keep board</button><button class="primary danger-fill" id="confirm-delete">Delete board</button></div>`,
          (dialog) => {
            dialog.querySelector("#cancel-delete").onclick = () =>
              dialog.close();
            dialog.querySelector("#confirm-delete").onclick = async (e) => {
              const button = e.currentTarget;
              if (button.disabled) return;
              button.disabled = true;
              // Trash keeps the board, so a version that cannot be saved,
              // as on a full device, does not stop it from being deleted.
              await local.checkpoint(b, "Before deletion").catch(() => {});
              b.deletedAt = Date.now();
              try {
                await local.save(b);
              } catch {
                delete b.deletedAt;
                button.disabled = false;
                return toast("Could not move this board to the trash.");
              }
              dialog.close();
              home();
            };
          },
        );
      };
    },
  );
}
window.addEventListener("storage", (e) => {
  if (e.key === "whiteboard-character-shortcuts" || e.key === null) {
    characterShortcuts = e.newValue !== "false";
    const input = document.querySelector("#character-shortcuts");
    if (input) input.checked = characterShortcuts;
  }
  if (e.key === PRECISE_SELECTION_KEY || e.key === null) {
    if (drag?.kind === "marquee") {
      canvasNavigation.cancel();
      cancelTransform();
    }
    preciseSelection = readPreciseSelection(e.newValue);
    const input = document.querySelector("#precise-selection");
    if (input) input.checked = preciseSelection;
  }
  if (e.key === DIMENSIONS_STORAGE_KEY || e.key === null) {
    if (drag?.kind === "resize") {
      canvasNavigation.cancel();
      cancelTransform();
    }
    showDimensions = readDimensions(e.newValue);
    const input = document.querySelector("#show-dimensions");
    if (input) input.checked = showDimensions;
    if (current) draw();
  }
  if (e.key === GRID_STORAGE_KEY || e.key === null) {
    if (drag && ["move", "resize", "arrow", "endpoint"].includes(drag.kind)) {
      canvasNavigation.cancel();
      cancelTransform();
    }
    boardGrid = readGrid(e.newValue);
    syncGridControls();
    if (current) draw();
  }
  if (e.key === STYLE_STORAGE_KEY || e.key === null) {
    copiedStyle = readObjectStyle(e.newValue);
    if (current) draw();
  }
  canvasNavigation.storage(e);
  const input = document.querySelector("#navigation-mode");
  if (input) input.value = canvasNavigation.mode();
});
function syncGridControls() {
  document.querySelectorAll('[name="board-grid-mode"]').forEach((input) => {
    input.checked = input.value === boardGrid.mode;
  });
  const snap = document.querySelector("#snap-grid");
  if (snap) {
    snap.checked = boardGrid.snap;
    snap.disabled = boardGrid.mode === "none";
  }
}
function setGrid(value) {
  boardGrid = normalizeGrid(value);
  try {
    localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify(boardGrid));
  } catch {}
  syncGridControls();
  if (current) draw();
}
function openGridSettings() {
  modal(
    "Grid and snapping",
    `<fieldset class="grid-options"><legend>Canvas grid</legend>${[
      ["none", "No grid"],
      ["lines", "Line grid"],
      ["dots", "Dot grid"],
    ]
      .map(
        ([mode, label]) =>
          `<label><input type="radio" name="board-grid-mode" value="${mode}"><span class="grid-preview grid-preview-${mode}" aria-hidden="true"></span><span>${label}</span></label>`,
      )
      .join(
        "",
      )}</fieldset><label class="grid-snap-option"><input type="checkbox" id="snap-grid">Snap to grid</label><p class="dialog-copy">New objects, moves, and resize edges snap to the visible grid. Object alignment guides take priority.</p><p class="dialog-copy">Hold Ctrl/Cmd or Alt/Option during a gesture to bypass grid snapping. Keyboard nudges and exact dimensions stay precise.</p><p class="dialog-copy">This preference is saved on this device and shared with other open tabs.</p>`,
    (d) => {
      syncGridControls();
      d.querySelectorAll('[name="board-grid-mode"]').forEach((input) => {
        input.onchange = () => setGrid({ ...boardGrid, mode: input.value });
      });
      d.querySelector("#snap-grid").onchange = (e) =>
        setGrid({ ...boardGrid, snap: e.target.checked });
    },
  );
}
function openDimensionSettings() {
  modal(
    "Object dimensions",
    `<label class="grid-snap-option"><input type="checkbox" id="show-dimensions">Show dimensions and matching-size guides</label><p class="dialog-copy">See the selection’s width and height in board pixels. Resize near another object’s width or height to match its size.</p><p class="dialog-copy">Matching sizes uses Snap to objects. Hold Alt/Option to bypass snapping. Exact numeric dimensions stay precise.</p><p class="dialog-copy">This preference is saved on this device and shared with other open tabs.</p>`,
    (d) => {
      const input = d.querySelector("#show-dimensions");
      input.checked = showDimensions;
      input.onchange = () => {
        showDimensions = input.checked;
        try {
          localStorage.setItem(DIMENSIONS_STORAGE_KEY, String(showDimensions));
        } catch {}
        draw();
      };
    },
  );
}
function navigationSettings() {
  modal(
    "Mouse, trackpad, and touch",
    `<label class="field">Navigation mode<select id="navigation-mode"><option value="auto">Auto-detect</option><option value="mouse">Mouse</option><option value="trackpad">Trackpad</option></select></label>
    <p class="dialog-copy">Auto-detect recognizes wheel steps and smooth scrolling. Choose a device if scrolling feels wrong.</p>
    <div class="navigation-help">
      <p><strong>Mouse</strong><span>Scroll to zoom. Right-drag, middle-drag, or Space-drag to pan.</span></p>
      <p><strong>Trackpad</strong><span>Scroll with two fingers to pan. Pinch or Ctrl/Cmd-scroll to zoom. Shift-scroll pans horizontally.</span></p>
      <p><strong>Touch</strong><span>Drag to pan and pinch to zoom. Tap an object to select it, then drag it to move. Hold for a moment, then drag to select several objects. Drawing tools still draw with one finger.</span></p>
    </div><p class="dialog-copy">This preference is saved on this device and shared with other open tabs.</p>`,
    (d) => {
      const input = d.querySelector("#navigation-mode");
      input.value = canvasNavigation.mode();
      input.onchange = () => canvasNavigation.setMode(input.value);
    },
  );
}
function openSelectionSettings() {
  modal(
    "Selection settings",
    `<label class="grid-snap-option"><input id="precise-selection" type="checkbox">Precise selection</label><p class="dialog-copy">Select objects when at least 90% is inside the selection box. Turn off to select touched objects. Tables and mind map nodes always require 90% coverage.</p><p class="dialog-copy">Hold the mouse or your finger still for a moment, then drag to use precise selection over background objects. Hold Shift while dragging to add to your selection. Escape cancels.</p><p class="dialog-copy">This preference is saved on this device and shared with other open tabs.</p>`,
    (d) => {
      const input = d.querySelector("#precise-selection");
      input.checked = preciseSelection;
      input.onchange = () => {
        preciseSelection = input.checked;
        try {
          localStorage.setItem(PRECISE_SELECTION_KEY, String(preciseSelection));
        } catch {}
      };
    },
  );
}
function help() {
  modal(
    "A few ways to find your flow",
    `<label class="grid-snap-option"><input type="checkbox" id="character-shortcuts" aria-describedby="character-shortcuts-help">Enable letter and symbol shortcuts</label><p id="character-shortcuts-help" class="dialog-copy">Turn off shortcuts such as N, Shift + N, and ? to avoid accidental actions. Ctrl/Cmd and Alt/Option shortcuts remain available. This preference is saved on this device and shared with other open tabs.</p><p class="dialog-copy">Choose a tool, then click the canvas. Double-click an object to edit its text. Drag a corner to resize. Paste text, links, or images, or drop files onto the canvas.</p><div class="shortcuts">${[
      ["V / H", "Select / pan"],
      ["N / T", "Sticky note / text"],
      ["C", "Comment"],
      ["Shift + C", "Show or hide comment pins"],
      ["Shift + N", "Bulk sticky notes"],
      ["R / O", "Rectangle / ellipse"],
      ["S", "Shapes"],
      ["A / P / F", "Arrow / draw / frame"],
      ["Space / right / middle + drag", "Move around the canvas"],
      ["Ctrl or Cmd + scroll", "Zoom toward the pointer"],
      ["M", "Minimap"],
      ["Ctrl/Cmd + Plus/Minus", "Zoom in or out"],
      ["Ctrl/Cmd + 0", "Reset zoom to 100 percent"],
      ["Alt/Option + 1 / 2", "Fit board / zoom to selection"],
      ["Shift + click", "Select multiple objects"],
      ["Ctrl/Cmd + F", "Find on board"],
      ["Ctrl/Cmd + K", "Command palette"],
      ["Arrow keys", "Move selected objects"],
      ["Alt / Option + drag", "Drag a copy"],
      ["Alt / Option + Arrow keys", "Duplicate in a direction"],
      ["Alt / Option during drag", "Temporarily bypass snapping"],
      ["Escape", "Cancel the current move or resize"],
      ["Shift + resize", "Toggle proportions while resizing"],
      ["Ctrl/Cmd + Alt/Option + Shift + Plus/Minus", "Resize selection"],
      ["Enter", "Select a group member or edit the focused object"],
      ["Ctrl/Cmd + Shift + Down / Up", "Select a group member / whole group"],
      ["Tab / Shift + Tab", "Indent / outdent a list item"],
      ["Shift + Enter", "Continue a list item on a new line"],
      ["Ctrl/Cmd + Alt/Option + K", "Insert or edit text link"],
      ["Ctrl/Cmd + Alt/Option + Shift + K", "Object link"],
      ["Ctrl/Cmd + Alt/Option + Shift + C", "Copy link to object"],
      ["Ctrl or Cmd + Z", "Undo"],
      ["Ctrl or Cmd + Shift + Z", "Redo"],
      ["Ctrl or Cmd + D", "Duplicate selection"],
      ["Ctrl or Cmd + Shift + L", "Lock or unlock selection"],
      ["Ctrl or Cmd + C / X / V", "Copy, cut, or paste objects"],
      ["Ctrl/Cmd + Shift + C", "Copy as image"],
      ["Ctrl/Cmd + Alt/Option + C", "Copy style"],
      ["Ctrl/Cmd + Alt/Option + V", "Paste style"],
      ["Ctrl or Cmd + [ / ]", "Send backward / bring forward"],
      ["Ctrl or Cmd + Shift + [ / ]", "Send to back / bring to front"],
      ["Ctrl/Cmd + Backspace", "Clear content of sticky notes and shapes"],
      ["Delete / Backspace", "Delete selection"],
    ]
      .map(([k, v]) => `<div><span>${v}</span><kbd>${k}</kbd></div>`)
      .join(
        "",
      )}</div><p class="dialog-copy">Keyboard-only? Use Board objects to select an object. Tool shortcuts add objects in the center of your view.</p>`,
    (d) => {
      const input = d.querySelector("#character-shortcuts");
      input.checked = characterShortcuts;
      input.onchange = () => {
        characterShortcuts = input.checked;
        try {
          localStorage.setItem(
            "whiteboard-character-shortcuts",
            String(characterShortcuts),
          );
        } catch {}
      };
    },
  );
}
function openContentLanguage() {
  const root = document.querySelector("#content-language-controls");
  const trigger = document.querySelector("#content-language-options");
  const board = current;
  const i = current.items.find((i) => selection.has(i.id));
  if (!root || !i || !canEditSelection(new Set([i.id]))) return;
  const close = () => {
    root.hidden = true;
    root.replaceChildren();
    trigger.setAttribute("aria-expanded", "false");
    document.querySelector("#content-language-options")?.focus();
  };
  if (!root.hidden) return close();
  const input = editing?.item.id === i.id ? editing.input : null;
  const openedLanguage = i.lang;
  const openedText = input?.value;
  const openedRuns = input && JSON.stringify(input.textRuns);
  root.innerHTML = `<form><label class="field">${t("Apply to")}<select id="content-language-scope">${input ? `<option value="text">${t("Selected text or next typed text")}</option>` : ""}<option value="object">${t("Whole object")}</option></select></label><label class="field">${t("Language tag")}<input id="content-language-tag" maxlength="64" placeholder="fr-CA" aria-describedby="content-language-help content-language-error" autocomplete="off" spellcheck="false"></label><p id="content-language-help" class="dialog-copy">${t("Enter a language tag, such as en, fr-CA, or es. Leave empty to inherit the surrounding language.")}</p><p id="content-language-error" role="alert" hidden></p><div class="dialog-footer"><button id="content-language-cancel" class="secondary" type="button">${t("Cancel")}</button><button id="content-language-save" class="primary" type="submit">${t("Apply language")}</button></div></form>`;
  const tag = root.querySelector("#content-language-tag");
  const scope = root.querySelector("#content-language-scope");
  const sync = () => {
    const value = scope.value === "text" ? input.rangeStyle("lang") : i.lang;
    tag.value = value && value !== "mixed" ? value : "";
  };
  scope.onchange = sync;
  sync();
  root.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  root.querySelector("#content-language-cancel").onclick = close;
  root.onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  root.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const target = current?.items.find((item) => item.id === i.id);
    if (current !== board || !target || !selection.has(i.id))
      return toast("This object changed. Open it again to edit it.");
    if (!canEditSelection(new Set([i.id]))) return;
    const value = tag.value.trim();
    const languageTag = value ? canonicalLanguage(value) : null;
    if (value && !languageTag) {
      const error = root.querySelector("#content-language-error");
      error.hidden = false;
      error.textContent = t("Enter a valid language tag, such as en or fr-CA.");
      tag.focus();
      return;
    }
    if (scope.value === "text") {
      if (
        editing?.input !== input ||
        input.value !== openedText ||
        JSON.stringify(input.textRuns) !== openedRuns
      )
        return toast("This object changed. Open it again to edit it.");
      input.format("lang", languageTag);
    } else {
      if (target.lang !== openedLanguage)
        return toast("This object changed. Open it again to edit it.");
      if ((target.lang || null) !== languageTag)
        mutate(() => {
          if (languageTag) target.lang = languageTag;
          else delete target.lang;
        });
    }
    close();
  };
  tag.focus();
}
function objectsDialog() {
  const board = current;
  modal(
    "Board objects",
    `<label class="search"><input id="object-search" aria-label="Search objects" placeholder="Search objects"></label><p class="dialog-copy">Select an object to move it with the arrow keys. Press Enter to edit.</p><label class="grid-snap-option"><input id="objects-multiple" type="checkbox">Select multiple objects</label><p class="dialog-copy">Turn on Select multiple objects, then click objects to add or remove them. Choose Done to use the selection.</p><p id="objects-selection-status" role="status" hidden></p><div class="object-list"></div><div class="dialog-footer" id="objects-selection-footer" hidden><button id="objects-done" class="primary">Done</button></div>`,
    (d) => {
      const multiple = d.querySelector("#objects-multiple");
      const finish = () => {
        d.close();
        if (selection.size)
          focusRegion(
            bounds(visibleItems().filter((i) => selection.has(i.id))),
          );
        draw();
        document.querySelector("#canvas").focus();
      };
      const states = () => {
        d.querySelector("#objects-selection-footer").hidden = !multiple.checked;
        const status = d.querySelector("#objects-selection-status");
        status.hidden = !multiple.checked;
        status.textContent = t(`${selection.size} selected`);
        for (const button of d.querySelectorAll("[data-object]")) {
          if (multiple.checked)
            button.setAttribute(
              "aria-pressed",
              String(selection.has(button.dataset.object)),
            );
          else button.removeAttribute("aria-pressed");
        }
      };
      const render = () => {
        // The board as this person sees it: hidden objects are left out and
        // others' private notes stay face down.
        const query = d.querySelector("input").value.toLocaleLowerCase(),
          items = facilitation.masked(current).items,
          relationships = objectRelationships(items),
          list = items.filter((i) =>
            objectName(i).toLocaleLowerCase().includes(query),
          );
        d.querySelector(".object-list").innerHTML = list.length
          ? list
              .map((i, n) => {
                const relationship = relationships.get(i.id);
                const description = `objects-relationship-${n}`;
                return `<button data-object="${escape(i.id)}" ${multiple.checked ? `aria-pressed="${selection.has(i.id)}"` : ""}${relationship ? ` aria-describedby="${description}"` : ""}><span data-user-content>${objectNameHTML(i)}</span></button>${relationship ? `<span class="sr-only" id="${description}">${relationship}</span>` : ""}`;
              })
              .join("")
          : `<p>${t("No matching objects.")}</p>`;
        d.querySelectorAll("[data-object]").forEach(
          (btn) =>
            (btn.onclick = () => {
              const i = current.items.find((i) => i.id === btn.dataset.object);
              if (
                current !== board ||
                !i ||
                facilitation.concealedIds().has(i.id)
              )
                return toast("This object changed. Open it again to edit it.");
              if (!multiple.checked) {
                selectItems(new Set([i.id]));
                return finish();
              }
              const concealed = facilitation.concealedIds();
              const chosen = new Set(
                [...selection].filter(
                  (id) =>
                    current.items.some((i) => i.id === id) &&
                    !concealed.has(id),
                ),
              );
              if (chosen.has(i.id))
                descendants(current.items, new Set([i.id])).forEach((id) =>
                  chosen.delete(id),
                );
              else chosen.add(i.id);
              selectItems(chosen);
              draw();
              states();
            }),
        );
        states();
      };
      render();
      d.querySelector("#object-search").oninput = render;
      multiple.onchange = render;
      d.querySelector("#objects-done").onclick = finish;
    },
  );
}
function duplicate(direction) {
  if (!selection.size) return;
  if (isSharedReadOnly()) return toast("This board is read-only.");
  // A copy would show hidden content to everyone.
  const hidden = facilitation.concealedIds();
  if ([...selection].some((id) => hidden.has(id)))
    return toast("Hidden objects cannot be copied.");
  pointerUp();
  try {
    const plan = planDuplication(current.items, selection, {
      ...selectionOptions(),
      hidden,
      direction,
    });
    if (!plan.copies.length) return;
    mutate(() => {
      current.items.push(...plan.copies);
      selection = plan.selection;
      focusedGroup = null;
      selectionAnchor = plan.idMap.get(selectionAnchor) || null;
      placeDuplicates(current.items, selection, facilitation.concealedIds());
    });
  } catch (error) {
    toast(error.message);
  }
}
// Undo and redo on a shared board change the shared document directly, not
// through the editor's save, so the facilitator's lock is checked here. A
// step the lock refuses is put back, keeping the rest of the history.
function sharedStep(step) {
  const session = collaboration;
  if (session.readOnly || session.contentReadOnly) return;
  const { shared } = session,
    manager = shared.undo;
  if (!(step === "undo" ? manager.canUndo() : manager.canRedo())) return;
  // Every step changes content, which a frozen board refuses; the shared
  // document is left untouched so the step waits for the board to open.
  const frozen = facilitation.frozen();
  if (frozen) return toast(frozen);
  const before = facilitation.restricts() ? shared.snapshot() : null;
  // Tried on a copy first: undoing and redoing a refused step would still
  // save its writes, which the worker refuses as they could overwrite a
  // facilitator's concurrent changes.
  if (before) {
    const stack = step === "undo" ? "undoStack" : "redoStack",
      // Keeping deleted content, which the step may bring back.
      trial = new SharedDocument(shared.update(), { gc: false });
    let reason;
    try {
      trial.undo[stack].push(manager[stack].at(-1));
      trial.undo[step]();
      reason = facilitation.refusal(before, trial.snapshot());
    } finally {
      trial.destroy();
    }
    if (reason) return toast(reason);
  }
  manager[step]();
  const reason = before && facilitation.refusal(before, shared.snapshot());
  if (reason) {
    manager[step === "undo" ? "redo" : "undo"]();
    return toast(reason);
  }
  session.publish().catch((e) => toast(e.message));
}
async function action(a) {
  if (!["participants", "commands", "more-tools", "timer"].includes(a))
    attention.stop();
  if (a !== "tags") tags.close();
  if (!planning.actions[a]) planning.close();
  if (!["object-link", "copy-object-link"].includes(a)) objectLinks.close();
  canvasNavigation.finish();
  minimap.cancel();
  imageCrop.close(false);
  imageReplacement.close();
  if (a === "cancel-text") return finishTextEdit(false, true);
  if (a === "finish-text") return finishTextEdit(true, true);
  if (a !== "toggle-snapping") pointerUp();
  finishTextEdit();
  if (features.actions[a]) return features.actions[a]();
  if (planning.actions[a]) return planning.actions[a]();
  if (a.startsWith("tool-")) return setTool(a.slice(5));
  switch (a) {
    case "toggle-snapping":
      snapping = !snapping;
      try {
        localStorage.setItem("whiteboard-snapping", String(snapping));
      } catch {}
      document
        .querySelector('[data-action="toggle-snapping"]')
        .setAttribute("aria-pressed", String(snapping));
      if (drag?.pointer) pointerMove(drag.pointer);
      toast(
        snapping ? "Snapping on. Hold Alt/Option to bypass." : "Snapping off.",
      );
      draw();
      return;
    case "new":
      return newBoard();
    case "home":
      if (current) {
        clearTimeout(cloudTimer);
        if (cloudIds.has(current.id)) await sync(clone(current));
        await saveChain;
      }
      return home();
    case "help":
      return help();
    case "cloud":
      return cloudDialog();
    case "cloud-save":
      return cloudSave();
    case "migrate-miro":
      return openMigration();
    case "org-library":
      return organizationLibrary.open();
    case "org-library-share":
      return organizationLibrary.share();
    case "ai":
      return ai.open();
    case "hide-objects":
    case "show-objects":
      return facilitation.setHidden([...selection], a === "hide-objects");
    case "alt-text":
      return altText.open(selectedLinkObject());
    case "help-center":
      return helpCenter.open();
    case "tour":
      return startTour();
    case "dismiss-tour":
      onboarding.dismiss();
      document.querySelector("#tour-offer")?.remove();
      return document.querySelector("#canvas")?.focus();
    case "import":
      return fileInput(".json", importBoard);
    case "image":
      return imageInput();
    case "crop-image":
      if (selection.size !== 1 || !canEditSelection()) return;
      return imageCrop.open(current.items.find((i) => selection.has(i.id)));
    case "add-note":
      return addObject("note");
    case "tags":
      return tags.open();
    case "comments":
      return comments.toggle();
    case "add-comment":
      return addComment();
    case "toggle-comment-pins":
      return comments.togglePins();
    case "board-search":
      objectLinks.close();
      comments.close(false);
      return boardSearch.open();
    case "objects":
      return objectsDialog();
    case "mind-child":
      return mindMap.add();
    case "mind-collapse":
      return toggleMindBranch();
    case "mind-sibling":
      return mindMap.add(true);
    case "mind-settings":
      return mindMap.settings();
    case "mind-layout":
      return mindMap.layout();
    case "mind-move":
      return mindMap.moveDialog();
    case "mind-earlier":
      return mindMap.reorder(-1);
    case "mind-later":
      return mindMap.reorder(1);
    case "table-cells": {
      const i = selectedLinkObject();
      if (i?.type === "table") return editObject(i);
      return;
    }
    case "object-link":
      return objectLinks.show();
    case "copy-object-link":
      return objectLinks.copy();
    case "text-link":
      return openTextLinkEditor();
    case "text-links": {
      const i =
        selection.size === 1 && current.items.find((i) => selection.has(i.id));
      if (i) textLinkPreview.show(i);
      return;
    }
    case "properties":
      return editObject(
        current.items.find((i) => selection.has(i.id)),
        true,
      );
    case "enter-group":
      return enterGroup();
    case "exit-group":
      return exitGroup();
    case "edit":
      return editObject(current.items.find((i) => selection.has(i.id)));
    case "duplicate":
      return duplicate();
    case "connection-endpoints":
      return connectionEndpoints(
        current.items.find((i) => selection.has(i.id)),
      );
    case "rotate":
      rotateSelectionDialog();
      break;
    case "resize":
      return resizeSelectionDialog();
    case "move-selection":
      return moveSelectionDialog();
    case "lock":
      return toggleLock();
    case "delete":
      if (!canEditSelection(selection, { deleting: true })) return;
      if (selection.size)
        mutate(() => {
          current.items = removeItems(
            current.items,
            selection,
            selectionOptions(),
          );
          selection.clear();
        });
      return;
    case "front":
    case "back":
    case "forward":
    case "backward": {
      if (!canEditSelection()) return;
      const next = reorderItems(
        current.items,
        selection,
        a,
        selectionOptions(),
      );
      if (next !== current.items) mutate(() => (current.items = next));
      return;
    }
    case "share":
      return shareBoard();
    case "join-shared":
      return joinDialog();
    case "participants":
      return participantsDialog();
    case "undo":
      if (collaboration) return sharedStep("undo");
      // Key repeat must not replace recovery versions with unchanged copies.
      if (isSharedReadOnly()) return toast("This board is read-only.");
      if (!history.past.length) return;
      checkpoint();
      restoreUndoState(history.undo(undoState()));
      selection.clear();
      draw();
      save();
      return;
    case "redo":
      if (collaboration) return sharedStep("redo");
      if (isSharedReadOnly()) return toast("This board is read-only.");
      if (!history.future.length) return;
      checkpoint();
      restoreUndoState(history.redo(undoState()));
      selection.clear();
      draw();
      save();
      return;
    case "fit":
      return fit();
    case "minimap":
      return minimap.toggle();
    case "zoom-selection":
      if (selection.size)
        focusRegion(bounds(visibleItems().filter((i) => selection.has(i.id))));
      return;
    case "zoom-in":
    case "zoom-out":
    case "reset-zoom": {
      const r = document.querySelector("#canvas").getBoundingClientRect();
      view = zoomAt(
        view,
        { x: r.width / 2, y: r.height / 2 },
        a === "reset-zoom" ? 1 : view.z * (a === "zoom-in" ? 1.2 : 1 / 1.2),
      );
      draw();
    }
  }
}
function bindShared() {
  document.querySelector("#language").onchange = (e) => {
    setLanguage(e.target.value);
    if (current) editor();
    else home();
  };
  document
    .querySelectorAll("[data-action]")
    .forEach((b) => (b.onclick = () => action(b.dataset.action)));
  document.querySelector("#theme").onchange = (e) => {
    theme = e.target.value;
    try {
      localStorage.setItem("whiteboard-theme", theme);
    } catch {}
    applyTheme();
    if (current) draw();
    else paintPreviews();
  };
}
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
  if (commandPalette.keydown(e)) return;
  if (!document.querySelector("dialog[open]") && boardSearch.keydown(e)) return;
  if (
    document.querySelector("dialog[open]") ||
    e.target.closest("input,textarea,select,[contenteditable]")
  )
    return;
  if (e.key === "Escape" && drag?.kind === "table-cells") {
    e.preventDefault();
    canvasNavigation.cancel();
    cancelTransform();
    return;
  }
  if (tableEditor.keydown(e)) return;
  // Shift still produces character-only shortcuts such as N and ?.
  // Component-local typing (e.g. native selects) is handled before here.
  if (
    !characterShortcuts &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    e.key.length === 1 &&
    e.key !== " "
  )
    return;
  if (!current) {
    if (e.key === "?") help();
    return;
  }
  if (!drag && mindMap.keydown(e)) return;
  if (
    ["Control", "Meta"].includes(e.key) &&
    (drag?.mind || drag?.gridStep) &&
    drag.pointer
  ) {
    e.preventDefault();
    pointerMove({ ...drag.pointer, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
    return;
  }
  if (e.key === "Alt" && drag?.pointer) {
    e.preventDefault();
    pointerMove({ ...drag.pointer, altKey: true });
    return;
  }
  if (
    e.key === "Shift" &&
    ["resize", "rotate", "endpoint", "arrow", "marquee"].includes(drag?.kind) &&
    drag.pointer
  ) {
    e.preventDefault();
    pointerMove({ ...drag.pointer, shiftKey: true });
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (
    mod &&
    e.altKey &&
    e.shiftKey &&
    ["KeyC", "KeyK"].includes(e.code || `Key${e.key.toUpperCase()}`)
  ) {
    e.preventDefault();
    if (!e.repeat)
      action(
        e.code === "KeyC" || e.key.toLowerCase() === "c"
          ? "copy-object-link"
          : "object-link",
      );
    return;
  }
  if (!mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === "c") {
    e.preventDefault();
    if (!e.repeat) action("toggle-comment-pins");
    return;
  }
  if (
    mod &&
    e.altKey &&
    !e.shiftKey &&
    ["KeyC", "KeyV"].includes(e.code || `Key${e.key.toUpperCase()}`)
  ) {
    e.preventDefault();
    if (!e.repeat)
      action(
        e.code === "KeyC" || (!e.code && e.key.toLowerCase() === "c")
          ? "copy-style"
          : "paste-style",
      );
    return;
  }
  if (mod && !e.shiftKey && optionKey(e, ["k"], ["KeyK"])) {
    e.preventDefault();
    openTextLinkEditor();
    return;
  }
  if (!mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "m") {
    e.preventDefault();
    if (!e.repeat) action("minimap");
    return;
  }
  if (mod && !e.altKey && ["+", "=", "-", "_", "0"].includes(e.key)) {
    e.preventDefault();
    action(
      e.key === "0"
        ? "reset-zoom"
        : ["+", "="].includes(e.key)
          ? "zoom-in"
          : "zoom-out",
    );
    return;
  }
  if (
    e.altKey &&
    !mod &&
    !e.shiftKey &&
    ["Digit1", "Digit2"].includes(e.code)
  ) {
    e.preventDefault();
    action(e.code === "Digit1" ? "fit" : "zoom-selection");
    return;
  }
  if (!mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (!e.repeat) action("shapes");
    return;
  }
  if (!mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === "n") {
    e.preventDefault();
    if (!e.repeat) action("bulk-notes");
    return;
  }
  if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") {
    e.preventDefault();
    if (!e.repeat) action("copy-image");
    return;
  }
  if (mod && !e.altKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    action("board-search");
    return;
  }
  if (
    mod &&
    e.shiftKey &&
    optionKey(e, ["+", "=", "-", "_"], ["Equal", "Minus"])
  ) {
    e.preventDefault();
    const larger = /^[+=_-]$/.test(e.key)
      ? ["+", "="].includes(e.key)
      : e.code === "Equal";
    resizeBy(larger ? 1.1 : 1 / 1.1);
    return;
  }
  if (e.code === "Space") {
    if (e.target.closest("button,a")) return;
    e.preventDefault();
    space = true;
    draw();
    return;
  }
  if (mod && ["b", "i", "u"].includes(e.key.toLowerCase())) {
    e.preventDefault();
    formatSelection(
      { b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()],
    );
    return;
  }
  if (mod && !e.altKey && ["BracketLeft", "BracketRight"].includes(e.code)) {
    e.preventDefault();
    const forward = e.code === "BracketRight";
    action(
      e.shiftKey
        ? forward
          ? "front"
          : "back"
        : forward
          ? "forward"
          : "backward",
    );
    return;
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    // A held key locks or unlocks once rather than flipping on each repeat.
    if (!e.repeat) action("lock");
    return;
  }
  if (
    mod &&
    e.shiftKey &&
    !e.altKey &&
    ["ArrowDown", "ArrowUp"].includes(e.key)
  ) {
    e.preventDefault();
    if (e.key === "ArrowUp") exitGroup();
    else enterGroup();
    return;
  }
  if (mod && e.key.toLowerCase() === "g") {
    e.preventDefault();
    if (!canEditSelection()) return;
    // With nothing to group or ungroup, the history and redo stay as they
    // were and the reason is said, as in the command palette.
    if (
      e.shiftKey
        ? !current.items.some((i) => selection.has(i.id) && i.groupId)
        : descendants(current.items, selection, selectionOptions()).size < 2
    )
      return toast(
        e.shiftKey
          ? "Select a group first."
          : "Select at least two objects to group.",
      );
    mutate(() => {
      if (e.shiftKey) ungroup(current.items, selection);
      else {
        selection = group(current.items, selection, selectionOptions());
        focusedGroup = null;
      }
    });
    return;
  }
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    action(e.shiftKey ? "redo" : "undo");
    return;
  }
  if (mod && e.key.toLowerCase() === "a") {
    e.preventDefault();
    pointerUp();
    selectionAnchor = null;
    focusedGroup = null;
    const hidden = facilitation.concealedIds();
    selection = unlockedSelection(
      current.items,
      new Set(current.items.filter((i) => !hidden.has(i.id)).map((i) => i.id)),
    );
    // A visible frame brings its contents back in; hidden ones stay out.
    if (hidden.size)
      selection = new Set([...selection].filter((id) => !hidden.has(id)));
    draw();
    return;
  }
  if (mod && e.key.toLowerCase() === "d") {
    e.preventDefault();
    duplicate();
    return;
  }
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    pointerUp();
    cloudSave();
    return;
  }
  if (mod && !e.altKey && !e.shiftKey && e.key === "Backspace") {
    e.preventDefault();
    if (!e.repeat) action("clear-content");
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    action("delete");
    return;
  }
  if (e.key === "Escape") {
    if (canvasNavigation.cancel()) {
      e.preventDefault();
      return;
    }
    if (
      drag &&
      ["move", "resize", "rotate", "endpoint", "arrow"].includes(drag.kind)
    ) {
      e.preventDefault();
      cancelTransform();
      return;
    }
    if (exitGroup()) {
      e.preventDefault();
      return;
    }
    selection.clear();
    setTool("select");
    return;
  }
  if (e.key === "Enter") {
    if (e.target.closest("button,a")) return;
    e.preventDefault();
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (id) selectItems(new Set([id]));
    if (enterGroup(id)) return;
    editObject(current.items.find((i) => selection.has(i.id)));
    return;
  }
  if (e.key.startsWith("Arrow") && selection.size) {
    e.preventDefault();
    if (e.altKey && !mod && !e.shiftKey) {
      if (!e.repeat && !drag) duplicate(e.key.slice(5).toLowerCase());
      return;
    }
    if (!canEditSelection()) return;
    const delta = e.shiftKey ? 10 : 1;
    // A held key moves the same objects as one step, so it cannot fill the
    // undo history or push out recovery versions. Anything undone or
    // changed since ends the step.
    const moving = [...selection].sort().join(),
      continues =
        e.repeat &&
        nudge?.ids === moving &&
        nudge.board === current &&
        nudge.items === current.items &&
        (collaboration || nudge.step === history.past.at(-1));
    mutate(
      () => {
        moveItems(
          current.items,
          selection,
          e.key === "ArrowRight" ? delta : e.key === "ArrowLeft" ? -delta : 0,
          e.key === "ArrowDown" ? delta : e.key === "ArrowUp" ? -delta : 0,
          selectionOptions(),
        );
        // Like dragging, moving objects into or out of a frame updates which
        // frame they belong to (and so a task's Kanban status).
        inferMovedParents(current.items, selection, {
          skip: facilitation.concealedIds(),
        });
      },
      { continues },
    );
    nudge = {
      ids: moving,
      board: current,
      items: current.items,
      step: history.past.at(-1),
    };
    return;
  }
  if (
    e.key.startsWith("Arrow") &&
    e.target.id === "canvas" &&
    !mod &&
    !e.altKey
  ) {
    e.preventDefault();
    const step = e.shiftKey ? 160 : 40;
    view.x += e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
    view.y += e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
    draw();
    return;
  }
  if (!mod && !e.altKey) {
    const t = tools.find((t) => t[3].toLowerCase() === e.key.toLowerCase());
    if (t) {
      e.preventDefault();
      // A held key adds one object, not a stack of them on each repeat.
      if (e.repeat) return;
      if (["note", "text", "rect", "ellipse", "frame"].includes(t[0]))
        addObject(t[0]);
      else setTool(t[0]);
    }
    if (e.key === "?") help();
  }
});
document.addEventListener("keyup", (e) => {
  if (
    ["Control", "Meta"].includes(e.key) &&
    (drag?.mind || drag?.gridStep) &&
    drag.pointer
  )
    pointerMove({ ...drag.pointer, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
  if (
    e.key === "Shift" &&
    ["resize", "rotate", "endpoint", "arrow", "marquee"].includes(drag?.kind) &&
    drag.pointer
  )
    pointerMove({ ...drag.pointer, shiftKey: false });
  if (e.key === "Alt" && drag?.pointer)
    pointerMove({ ...drag.pointer, altKey: false });
  if (e.code === "Space") {
    space = false;
    if (current) draw();
  }
});
window.addEventListener("blur", () => {
  comments.cancel();
  canvasNavigation.cancel();
  minimap.cancel();
  quickPorts.cancel();
  mindHandles.cancel();
  mindCollapse.cancel();
  tableEditor.cancelResize();
  space = false;
  pointerUp();
});
window.addEventListener("beforeunload", (e) => {
  canvasNavigation.finish();
  pointerUp();
  finishTextEdit();
  if (
    pendingCloud.size ||
    collaboration?.unsaved ||
    collaborationBusy ||
    collaborationPendingEdits ||
    unsentBoards.size
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});
try {
  boards = await local.list();
  await home({ keepAddress: true });
  if (new URLSearchParams(location.hash.slice(1)).has("board"))
    joinDialog(location.href);
  else if (readOrganizationLink(location.href))
    organizationHome.joinDialog(location.href);
  else await followBoardAddress(location.href);
  reconnectOrganization().catch(() => {});
} catch (error) {
  console.error("Whiteboard initialization failed", error);
  app.innerHTML =
    '<main class="fatal"><h1>Your browser storage is unavailable.</h1><p>Enable site storage and reload to start creating safely.</p><button onclick="location.reload()">Reload</button></main>';
}

let addressQueue = Promise.resolve();
function addressChanged() {
  const requested = location.href,
    saved = window.history.state?.whiteboard;
  addressQueue = addressQueue
    .catch(() => {})
    .then(async () => {
      if (location.href !== requested) return;
      if (saved) {
        const target = boards.find(
          (b) => b.id === saved.boardId && !b.deletedAt,
        );
        if (!target) return;
        canvasNavigation.finish();
        pointerUp();
        finishTextEdit();
        await saveChain;
        if (location.href !== requested) return;
        if (current !== target) await openBoard(target, { keepAddress: true });
        if (current !== target || location.href !== requested) return;
        objectLinks.close();
        comments.close(false);
        boardSearch.close(false);
        imageCrop.close(false);
        imageReplacement.close();
        view = { ...saved.view };
        selection = new Set(
          saved.selection.filter((id) => target.items.some((i) => i.id === id)),
        );
        selectionAnchor = selection.has(saved.anchor) ? saved.anchor : null;
        focusedGroup = saved.focusedGroup || null;
        draw();
      } else await followBoardAddress(requested);
    })
    .catch((e) => toast(e.message));
}
window.addEventListener("hashchange", addressChanged);
window.addEventListener("popstate", addressChanged);

window.addEventListener("resize", () => {
  canvasNavigation.cancel();
  attention.resize();
  onboarding.reposition();
  if (current) draw();
  else paintPreviews();
});
document.fonts?.ready.then(() => {
  clearTextLayoutCache();
  clearTagLayouts();
  clearConnectorLabelCache();
  if (current) draw();
  else paintPreviews();
});
document.fonts?.addEventListener("loadingdone", () => {
  clearTextLayoutCache();
  clearTagLayouts();
  clearConnectorLabelCache();
  if (current) draw();
  else paintPreviews();
});
