// The look: green solder mask, ENIG gold, bare copper for the dam, white silkscreen,
// amber current, silver water. Every colour the renderer uses comes from here.
export const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const PAL = {
  bg: '#05190F', weaveA: 'rgba(120,200,150,0.045)', weaveA2: 'rgba(120,200,150,0.03)', weaveB: 'rgba(0,0,0,0.10)',
  under: 'rgba(60,140,96,0.22)',                                  // bottom-layer copper seen through the laminate
  pour: { fill: '#1C6A44', rim: '#4AA977' },
  fence: { ring: 'rgba(63,158,108,0.85)', hole: 'rgba(3,18,11,0.85)' },
  trace: { rim: '#4AA977', fill: '#2B8158' },
  pad: { fill: '#D9B25B', edge: '#A07B30', sheen: 'rgba(255,240,190,0.28)', hole: '#06130D' },
  copper: { hi: '#F2B184', mid: '#C9784A', lo: '#8F4C27', edge: '#6E3A1E' },
  silk: '#F2EEE1',
  cur: { g: [255, 190, 84], h: [255, 236, 180], e: [255, 196, 110] },
  water: { g: [170, 214, 226], h: [228, 246, 252] },
  vig: 'rgba(0,10,6,0.55)',
  desk: '#0B0D0C', deskHi: 'rgba(52,56,50,0.45)',
};
