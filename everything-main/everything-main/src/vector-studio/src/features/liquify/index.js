/**
 * Liquify feature: the Warp, Twirl, Pucker, Bloat, Scallop, Crystallize and
 * Wrinkle brush tools for distorting paths by hand, the Pin Warp tool and
 * the Sketch Shape tool.
 */
import './icons.js';
import { LIQUIFY_TOOLS } from './tools.js';
import { PinWarpTool } from './pin-warp.js';
import { SketchShapeTool } from './sketch-shape.js';

export function install(app) {
  for (const T of LIQUIFY_TOOLS) app.registerTool(T);
  app.registerTool(PinWarpTool);
  app.registerTool(SketchShapeTool);
}
