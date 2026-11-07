// The library of original custom shapes, drawn for Photo Studio on a 100 x 100
// grid, in named groups for the Shapes panel. Pure data (no DOM) so filters
// running in workers can use the shapes as kernels. Holes use the even-odd rule.
export type ShapeGroup = 'Arrows' | 'Symbols' | 'Nature' | 'Objects' | 'Banners and Badges' | 'Ornaments';
export type CustomShape = { id: string; name: string; d: string; user?: boolean; group?: ShapeGroup };
export const shapeGroups: ShapeGroup[] = ['Arrows', 'Symbols', 'Nature', 'Objects', 'Banners and Badges', 'Ornaments'];

const circle = (cx: number, cy: number, r: number) => {
  const k = r * 0.5522847498307936;
  return `M${cx} ${cy - r}C${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}C${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}C${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}C${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}Z`;
};
const star = (points: number, inner: number, rotate = -90) => {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const a = ((rotate + (i * 180) / points) * Math.PI) / 180, r = i % 2 ? 50 * inner : 50;
    d += `${i ? 'L' : 'M'}${(50 + Math.cos(a) * r).toFixed(3)} ${(50 + Math.sin(a) * r).toFixed(3)}`;
  }
  return d + 'Z';
};
// Regular polygon with a vertex at the top.
const polygon = (sides: number, r = 50) => {
  let d = '';
  for (let i = 0; i < sides; i++) {
    const a = ((-90 + (i * 360) / sides) * Math.PI) / 180;
    d += `${i ? 'L' : 'M'}${(50 + Math.cos(a) * r).toFixed(3)} ${(50 + Math.sin(a) * r).toFixed(3)}`;
  }
  return d + 'Z';
};
// Petals: ellipses around the center (separate, non-overlapping subpaths).
const petals = (count: number, dist: number, rx: number, ry: number) => {
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = (i * 2 * Math.PI) / count - Math.PI / 2;
    const cx = 50 + Math.cos(a) * dist, cy = 50 + Math.sin(a) * dist;
    const k = 0.5522847498307936;
    // Ellipse rotated to point outward.
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const P = (u: number, v: number) => `${(cx + ux * u * ry + vx * v * rx).toFixed(3)} ${(cy + uy * u * ry + vy * v * rx).toFixed(3)}`;
    d += `M${P(1, 0)}C${P(1, k)} ${P(k, 1)} ${P(0, 1)}C${P(-k, 1)} ${P(-1, k)} ${P(-1, 0)}C${P(-1, -k)} ${P(-k, -1)} ${P(0, -1)}C${P(k, -1)} ${P(1, -k)} ${P(1, 0)}Z`;
  }
  return d;
};
const gear = (teeth: number) => {
  let d = '';
  const step = 360 / teeth;
  for (let i = 0; i < teeth; i++) {
    const base = i * step - 90;
    for (const [da, r] of [[0, 38], [step * 0.18, 50], [step * 0.48, 50], [step * 0.66, 38]] as const) {
      const a = ((base + da) * Math.PI) / 180;
      d += `${d ? 'L' : 'M'}${(50 + Math.cos(a) * r).toFixed(3)} ${(50 + Math.sin(a) * r).toFixed(3)}`;
    }
  }
  return d + 'Z' + circle(50, 50, 15);
};

export const builtinShapes: CustomShape[] = [
  { id: 'arrow-right', name: 'Arrow Right', d: 'M0 35H58V12L100 50L58 88V65H0Z' , group: 'Arrows' },
  { id: 'arrow-left', name: 'Arrow Left', d: 'M100 35H42V12L0 50L42 88V65H100Z' , group: 'Arrows' },
  { id: 'arrow-double', name: 'Double Arrow', d: 'M0 50L26 18V37H74V18L100 50L74 82V63H26V82Z' , group: 'Arrows' },
  { id: 'arrow-turn', name: 'Turn Arrow', d: 'M8 95V58C8 32 28 20 54 20H66V4L96 32L66 60V44H54C41 44 32 50 32 62V95Z' , group: 'Arrows' },
  { id: 'chevron', name: 'Chevron', d: 'M0 0H44L76 50L44 100H0L32 50Z' , group: 'Arrows' },
  { id: 'heart', name: 'Heart', d: 'M50 94C20 72 0 54 0 31C0 14 13 3 28 3C38 3 46 9 50 17C54 9 62 3 72 3C87 3 100 14 100 31C100 54 80 72 50 94Z' , group: 'Symbols' },
  { id: 'star', name: 'Star', d: star(5, 0.42) , group: 'Symbols' },
  { id: 'burst', name: 'Burst', d: star(14, 0.72) , group: 'Banners and Badges' },
  { id: 'speech', name: 'Speech Bubble', d: 'M12 4H88C95 4 100 9 100 16V58C100 65 95 70 88 70H46L22 94L27 70H12C5 70 0 65 0 58V16C0 9 5 4 12 4Z' , group: 'Objects' },
  { id: 'cloud', name: 'Cloud', d: 'M24 82C10 82 0 72 0 59C0 47 9 38 21 36C23 21 35 12 50 12C63 12 73 20 77 32C90 32 100 43 100 57C100 71 89 82 75 82Z' , group: 'Nature' },
  { id: 'check', name: 'Check Mark', d: 'M4 54L18 40L38 60L82 16L96 30L38 88Z' , group: 'Symbols' },
  { id: 'cross', name: 'Cross', d: 'M18 4L50 36L82 4L96 18L64 50L96 82L82 96L50 64L18 96L4 82L36 50L4 18Z' , group: 'Symbols' },
  { id: 'plus', name: 'Plus', d: 'M38 0H62V38H100V62H62V100H38V62H0V38H38Z' , group: 'Symbols' },
  { id: 'ring', name: 'Ring', d: circle(50, 50, 50) + circle(50, 50, 28) , group: 'Symbols' },
  { id: 'bolt', name: 'Lightning', d: 'M62 0L14 56H45L34 100L86 40H55L72 0Z' , group: 'Nature' },
  { id: 'moon', name: 'Crescent', d: 'M62 0C31 5 8 30 8 56C8 82 30 100 58 100C78 100 92 90 100 76C92 80 85 82 76 82C52 82 34 62 34 40C34 22 45 8 62 0Z' , group: 'Nature' },
  { id: 'drop', name: 'Drop', d: 'M50 0C50 0 85 42 85 65C85 85 69 100 50 100C31 100 15 85 15 65C15 42 50 0 50 0Z' , group: 'Nature' },
  { id: 'shield', name: 'Shield', d: 'M50 0L95 15V45C95 72 76 90 50 100C24 90 5 72 5 45V15Z' , group: 'Banners and Badges' },
  { id: 'tag', name: 'Tag', d: 'M0 20C0 9 9 0 20 0H64L100 50L64 100H20C9 100 0 91 0 80Z' + circle(24, 50, 8) , group: 'Objects' },
  { id: 'pin', name: 'Map Pin', d: 'M50 100C50 100 14 62 14 37C14 17 30 1 50 1C70 1 86 17 86 37C86 62 50 100 50 100Z' + circle(50, 37, 13) , group: 'Objects' },
  { id: 'house', name: 'House', d: 'M50 4L100 48H86V96H60V66H40V96H14V48H0Z' , group: 'Objects' },
  { id: 'gear', name: 'Gear', d: gear(9) , group: 'Objects' },
  // Added for the Shapes panel.
  { id: 'arrow-up', name: 'Arrow Up', d: 'M35 100V42H12L50 0L88 42H65V100Z', group: 'Arrows' },
  { id: 'arrow-down', name: 'Arrow Down', d: 'M35 0V58H12L50 100L88 58H65V0Z', group: 'Arrows' },
  { id: 'arrow-curve', name: 'Curved Arrow', d: 'M4 92C4 52 30 26 66 24V6L98 36L66 66V48C40 50 22 66 20 92Z', group: 'Arrows' },
  { id: 'arrow-split', name: 'Split Arrow', d: 'M0 44H38L62 18H52V4H96V48H82V38L58 64H0Z', group: 'Arrows' },
  { id: 'arrows-cross', name: 'Four Arrows', d: 'M50 0L68 20H58V42H80V32L100 50L80 68V58H58V80H68L50 100L32 80H42V58H20V68L0 50L20 32V42H42V20H32Z', group: 'Arrows' },
  { id: 'chevron-double', name: 'Double Chevron', d: 'M0 0H26L54 50L26 100H0L28 50ZM44 0H70L98 50L70 100H44L72 50Z', group: 'Arrows' },
  { id: 'diamond', name: 'Diamond', d: 'M50 0L100 50L50 100L0 50Z', group: 'Symbols' },
  { id: 'hexagon', name: 'Hexagon', d: polygon(6), group: 'Symbols' },
  { id: 'pentagon', name: 'Pentagon', d: polygon(5), group: 'Symbols' },
  { id: 'sparkle', name: 'Sparkle', d: 'M50 0C54 30 70 46 100 50C70 54 54 70 50 100C46 70 30 54 0 50C30 46 46 30 50 0Z', group: 'Symbols' },
  { id: 'star-six', name: 'Six-Point Star', d: star(6, 0.58), group: 'Symbols' },
  { id: 'target', name: 'Target', d: circle(50, 50, 50) + circle(50, 50, 36) + circle(50, 50, 22) + circle(50, 50, 9), group: 'Symbols' },
  { id: 'leaf', name: 'Leaf', d: 'M6 94C2 46 34 8 94 4C96 60 60 94 6 94ZM16 86L70 28L73 31L19 89Z', group: 'Nature' },
  { id: 'flower', name: 'Flower', d: petals(6, 32, 13, 18) + circle(50, 50, 13), group: 'Nature' },
  { id: 'sun', name: 'Sun', d: circle(50, 50, 24) + petals(8, 41, 4.5, 9), group: 'Nature' },
  { id: 'pine', name: 'Pine Tree', d: 'M50 0L80 38H66L88 68H58V100H42V68H12L34 38H20Z', group: 'Nature' },
  { id: 'mountains', name: 'Mountains', d: 'M0 90L34 28L50 54L66 34L100 90Z', group: 'Nature' },
  { id: 'wave', name: 'Wave', d: 'M0 56C12 40 26 40 38 56C50 72 62 72 74 56C84 44 92 42 100 46V100H0Z', group: 'Nature' },
  { id: 'envelope', name: 'Envelope', d: 'M2 16H98V84H2ZM12 24L50 54L88 24Z', group: 'Objects' },
  { id: 'lock', name: 'Padlock', d: 'M28 44V30C28 6 72 6 72 30V44H60V30C60 18 40 18 40 30V44ZM16 44H84V98H16Z' + circle(50, 66, 7), group: 'Objects' },
  { id: 'bell', name: 'Bell', d: 'M50 4C30 4 22 22 22 42V64L10 78H90L78 64V42C78 22 70 4 50 4Z' + circle(50, 89, 8), group: 'Objects' },
  { id: 'bulb', name: 'Light Bulb', d: 'M50 2C28 2 16 18 16 36C16 50 26 58 32 66V78H68V66C74 58 84 50 84 36C84 18 72 2 50 2ZM34 84H66V92H34Z', group: 'Objects' },
  { id: 'camera', name: 'Camera', d: 'M4 28H28L36 14H64L72 28H96V86H4Z' + circle(50, 56, 20) + circle(50, 56, 11), group: 'Objects' },
  { id: 'ribbon', name: 'Ribbon Banner', d: 'M0 30H100L88 50L100 70H0L12 50Z', group: 'Banners and Badges' },
  { id: 'seal', name: 'Seal', d: star(20, 0.88) + circle(50, 50, 30), group: 'Banners and Badges' },
  { id: 'ticket', name: 'Ticket', d: 'M0 20H100V40C92 40 88 44 88 50C88 56 92 60 100 60V80H0V60C8 60 12 56 12 50C12 44 8 40 0 40Z', group: 'Banners and Badges' },
  { id: 'frame-square', name: 'Square Frame', d: 'M0 0H100V100H0ZM10 10V90H90V10Z', group: 'Banners and Badges' },
  { id: 'pennant', name: 'Pennant', d: 'M0 0H100L60 50L100 100H0Z', group: 'Banners and Badges' },
  { id: 'divider', name: 'Divider', d: 'M0 47H38L50 35L62 47H100V53H62L50 65L38 53H0Z', group: 'Ornaments' },
  { id: 'corner', name: 'Corner', d: 'M0 0H70V10H10V70H0ZM20 20H40V40H20Z', group: 'Ornaments' },
  { id: 'lozenge-chain', name: 'Lozenge Chain', d: 'M0 50L12 38L24 50L12 62ZM26 50L38 38L50 50L38 62ZM52 50L64 38L76 50L64 62ZM78 50L90 38L100 48V52L90 62Z', group: 'Ornaments' },
  { id: 'rosette', name: 'Rosette', d: petals(8, 32, 10, 17) + circle(50, 50, 14) + circle(50, 50, 7), group: 'Ornaments' },
  { id: 'scallop', name: 'Scallop', d: 'M0 70C0 58 10 50 20 50C30 50 40 58 40 70C40 58 50 50 60 50C70 50 80 58 80 70C80 58 90 50 100 54V80H0Z', group: 'Ornaments' },
];

