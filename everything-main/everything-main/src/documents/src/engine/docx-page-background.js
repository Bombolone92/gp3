import { imageReader, A, R, WP, PIC } from './docx-images.js';
import { parseXml } from './docx-xml.js';
import { UnsupportedDocumentError } from './errors.js';
import { imageInfo } from './images.js';
import { pictureResolution } from './picture-resolution.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml', O = 'urn:schemas-microsoft-com:office:office';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const fail = () => { throw new UnsupportedDocumentError('unsupported page picture background'); };
const elements = node => [...node.children];
function attributes(node, allowed) {
  for (const a of node.attributes) if (a.namespaceURI !== XMLNS && !allowed.includes(`${a.namespaceURI || ''}:${a.localName}`)) fail();
}

/** Resolve a retained VML background through the same media gates as pictures. */
export function readPageBackground(root, readColor, parts, assets) {
  const nodes = elements(root).filter(n => n.namespaceURI === W && n.localName === 'background');
  if (!nodes.length) return { color: 'auto', picture: null };
  if (nodes.length !== 1) fail();
  const background = nodes[0], wrapper = root.cloneNode(false);
  wrapper.append(background.cloneNode(false));
  const color = readColor(wrapper, 'background') ?? 'auto', children = elements(background);
  if (!children.length) return { color, picture: null };
  if (children.length !== 1 || children[0].namespaceURI !== V || children[0].localName !== 'background') fail();
  const shape = children[0];
  attributes(shape, [':id', `${O}:bwmode`, `${O}:targetscreensize`]);
  if (shape.hasAttributeNS(O, 'bwmode') && shape.getAttributeNS(O, 'bwmode') !== 'white') fail();
  if (shape.hasAttributeNS(O, 'targetscreensize') && !/^\d+,\d+$/.test(shape.getAttributeNS(O, 'targetscreensize'))) fail();
  const fills = elements(shape);
  if (fills.length !== 1 || fills[0].namespaceURI !== V || fills[0].localName !== 'fill') fail();
  const fill = fills[0];
  attributes(fill, [':type', ':color2', ':recolor', `${O}:title`, `${R}:id`]);
  if (elements(fill).length || !['frame', 'tile'].includes(fill.getAttribute('type'))) fail();
  if (fill.hasAttribute('recolor') && !['t','f','true','false','1','0'].includes(fill.getAttribute('recolor'))) fail();
  if (fill.hasAttribute('color2') && !/^#[\da-f]{6}(?:\s+\[\d+\])?$/i.test(fill.getAttribute('color2'))) fail();
  const relationship = fill.getAttributeNS(R, 'id'); if (!relationship) fail();
  // This transient DrawingML wrapper only resolves the referenced media. It is
  // never serialized; source VML, relationships and embedded bytes stay intact.
  const drawing = parseXml(`<w:drawing xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Page background"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Page background"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`).documentElement;
  drawing.getElementsByTagNameNS(A, 'blip')[0].setAttributeNS(R, 'r:embed', relationship);
  const pending = {}, image = imageReader(parts, pending, null, readColor.drawingScheme)(drawing);
  if (!['image/png', 'image/jpeg'].includes(pending[image.assetId]?.mime)) fail();
  const asset = pending[image.assetId], info = imageInfo(asset.bytes), dpi = pictureResolution(asset.bytes);
  const frame = fill.getAttribute('type') === 'frame';
  // A frame background repeats at printer-pixel scale. Explicit tiles use
  // intrinsic DPI, with each physical dimension rounded up to a 600dpi pixel.
  const width = (frame ? info.width : Math.ceil(info.width * 600 / dpi.x)) * 96 / 600;
  const height = (frame ? info.height : Math.ceil(info.height * 600 / dpi.y)) * 96 / 600;
  assets[image.assetId] ||= asset;
  return { color, picture: { assetId: image.assetId, width, height } };
}
