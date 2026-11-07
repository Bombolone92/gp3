// Every time in the film, in seconds. Camera keys live in scene.js next to the shots they drive.
// The narration (voice/, 11 lines) is placed in VO below; the shot table is in DEMO.md.
export const T = {
  DUR: 59.6,
  title: [0.15, 1.1, 4.4, 5.0],   // the title is cut into the night sky, held, and taken back as the camera sinks
  bridgeHold: [7.6, 10.0],        // the bridge plate and the thermometer, held to read
  underBridge: 10.05,             // through the bridge, out into the dawn
  dawn: [10.8, 16.2],             // the sky is carved from the horizon up
  wake: [13.75, 15.4],            // the red crowns wake, left to right (after "…是丹顶鹤")
  pairCall: 15.1,                 // the nearest pair calls in unison
  takeoff: 16.2,                  // the flock runs and lifts off the water
  whiteIn: 18.7, cutB: 18.95, whiteOut: 19.15,   // through the steam
  tilt: [20.5, 22.2],             // the aerial tilts down to the field grid at "开垦"
  cutC: 24.0,                     // match on the descent into the feeding field
  landed: 26.8,                   // the bird we follow touches down
  sign1: [28.6, 33.6],            // the board: winter 1952, 33
  prints: [33.6, 41.3],           // the 1952 print held, corn scattered, then three peels
  corn: [36.6, 37.9],             // corn spreads on the snow at "投喂"
  peels: [38.9, 39.7, 40.4],      // each peel takes 0.3 s
  verdict: [41.3, 51.4],          // 2025 cut in; struck at "易危", sealed at "近危"
  carveDate: [41.6, 42.4], carveNum: [42.6, 43.7], strike: 47.6, stamp: 48.55,
  dance: [51.4, 56.4],            // the pair dances; the camera rises to the opening angle
  end: [56.4, 59.6],              // the end card is cut into the sky over the still wide shot
};
// narration: line id, start (s); durations are in voice/zh/dur.json (the English reading starts at the same moments). English is a free translation for the subtitle bar.
export const VO = [
  ['l01', 1.0, '这么冷的清晨，河水却没有结冰，还升腾着阵阵白汽。', 'On a morning this cold, the river still hasn’t frozen; it breathes white steam.'],
  ['l02', 5.4, '这里是北海道东部的湿地。', 'This is a wetland in eastern Hokkaido.'],
  ['l03', 10.8, '站在河水里安静睡觉的，是丹顶鹤。', 'Asleep, standing in the water: red-crowned cranes.'],
  ['l04', 19.2, '早年间，随着湿地被一片片开垦，它们差点就彻底失去了家园。', 'Long ago, as the wetlands were cleared field by field, they nearly lost their home for good.'],
  ['l05', 24.2, '天亮后，它们成群飞去的地方，是一块专门撒满玉米的田地。', 'At daybreak they fly in flocks to a field scattered with corn, just for them.'],
  ['l06', 28.8, '回想一九五二年冬天，整个北海道，一共只找到了三十三只丹顶鹤。', 'Think back to the winter of 1952: in all of Hokkaido, only 33 cranes were found.'],
  ['l07', 33.8, '也是从那一年起，当地人决定在冬天给它们投喂食物。', 'That was the year local people decided to feed them through the winter.'],
  ['l08', 38.1, '就这样，丹顶鹤的数量，一年比一年多。', 'And so, year after year, there were more of them.'],
  ['l09', 41.5, '到了二零二五年，已经数到了一千九百二十七只。', 'By 2025 the count had reached 1,927.'],
  ['l10', 45.9, '它们的保护级别，也终于从易危，降到了近危。', 'Their status finally eased, from Vulnerable to Near Threatened.'],
  ['l11', 51.6, '虽然不再算作濒危物种了，但这群雪地里的精灵，依然需要人们的守护。', 'No longer counted as endangered, these spirits of the snow still need people to look after them.'],
];
