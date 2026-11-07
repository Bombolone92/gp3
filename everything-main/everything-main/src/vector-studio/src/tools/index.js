/** Core tool classes, in registration order. Feature modules register more. */
import { SelectionTool } from './selection.js';
import { DirectSelectionTool, GroupSelectionTool, LassoTool } from './direct-selection.js';
import { PenTool, AddAnchorTool, DeleteAnchorTool, AnchorPointTool, CurvatureTool } from './pen.js';
import { RectangleTool, RoundedRectangleTool, EllipseTool, PolygonTool, StarTool, LineTool, ArcTool, SpiralTool, RectGridTool, PolarGridTool } from './shapes.js';
import { PencilTool, PaintbrushTool, SmoothTool, PathEraserTool } from './freehand.js';
import { HandTool, ZoomTool, RotateViewTool, EyedropperTool } from './navigation.js';
import { RotateTool, ReflectTool, ScaleTool, ShearTool } from './transform-tools.js';

export const CORE_TOOLS = [
  SelectionTool,
  DirectSelectionTool,
  GroupSelectionTool,
  LassoTool,
  PenTool,
  AddAnchorTool,
  DeleteAnchorTool,
  AnchorPointTool,
  CurvatureTool,
  PencilTool,
  SmoothTool,
  PathEraserTool,
  PaintbrushTool,
  RectangleTool,
  RoundedRectangleTool,
  EllipseTool,
  PolygonTool,
  StarTool,
  LineTool,
  ArcTool,
  SpiralTool,
  RectGridTool,
  PolarGridTool,
  RotateTool,
  ReflectTool,
  ScaleTool,
  ShearTool,
  EyedropperTool,
  HandTool,
  RotateViewTool,
  ZoomTool,
];
