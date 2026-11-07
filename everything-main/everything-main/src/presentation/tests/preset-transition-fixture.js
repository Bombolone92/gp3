import { NS } from "../lib/pptx/src/internal/xml/index.ts";

export const presetTransition = (
  preset = "pageCurlDouble",
  {
    inversion = "",
    duration = "2450",
    fallback = "fade",
    prefix = "preset",
  } = {},
) =>
  `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:${prefix}="${NS.p15}" xmlns:duration="${NS.p14}"><mc:Choice Requires="${prefix}"><p:transition spd="slow" duration:dur="${duration}" advClick="0" advTm="8100"><${prefix}:prstTrans prst="${preset}" ${inversion}/></p:transition></mc:Choice><mc:Fallback><p:transition spd="med" advTm="9200"><p:${fallback}/></p:transition></mc:Fallback></mc:AlternateContent>`;
