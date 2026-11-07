// Standard Windows system palette used by the native print reference. Keep this
// independent of page/app CSS: browser legacy system colors do not expose the
// native Windows border, caption, tooltip and gradient colors consistently.
// Custom OS palettes are not currently represented by the document model.
export const drawingSystemColors = Object.freeze({
  scrollBar: 'C8C8C8', background: '000000', activeCaption: '99B4D1',
  inactiveCaption: 'BFCDDB', menu: 'F0F0F0', window: 'FFFFFF',
  windowFrame: '646464', menuText: '000000', windowText: '000000',
  captionText: '000000', activeBorder: 'B4B4B4', inactiveBorder: 'F4F7FC',
  appWorkspace: 'ABABAB', highlight: '0078D7', highlightText: 'FFFFFF',
  btnFace: 'F0F0F0', btnShadow: 'A0A0A0', grayText: '6D6D6D',
  btnText: '000000', inactiveCaptionText: '000000', btnHighlight: 'FFFFFF',
  '3dDkShadow': '696969', '3dLight': 'E3E3E3', infoText: '000000',
  infoBk: 'FFFFE1', hotLight: '0066CC', gradientActiveCaption: 'B9D1EA',
  gradientInactiveCaption: 'D7E4F2', menuHighlight: '3399FF', menuBar: 'F0F0F0',
});
