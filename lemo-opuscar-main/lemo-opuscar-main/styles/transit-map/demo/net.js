// Schematic of the Shanghai Metro network, drawn by hand on an octilinear grid (0/45/90 degrees).
// Unofficial: geometry is our own schematic, not the operator's map. Units: G = 1 grid step = 100 world units.
// x grows east, y grows south. People's Square is the origin.
// Lines: {id, color, route, branch?, mode?: 'metro' (default) | 'light' | 'bus' | 'ferry', bullet?: text in the bullet
// (default: the id), ink?: ink text in the bullet (default: on colours lighter than 0.4 relative luminance), loop?}.
// Route items: 'ID' = the station's point; ['ID', dx, dy] = that station, offset for this line (parallel pairs);
// [x, y] = a bend. Stations carry {zh, en, tier}: tier 1 = big hub (label at every zoom), 2 = interchange, 3 = named stop.
(function () {
const G = 100;
const ST = {
  // ---- Line 1
  FJL: [0, -11, '富锦路', 'Fujin Road', 3],
  GFXC: [0, -8.6, '共富新村', 'Gongfu Xincun', 4],
  PPXC: [0, -6.6, '彭浦新村', 'Pengpu Xincun', 4],
  YCL: [0, -4.6, '延长路', 'Yanchang Road', 4],
  SHZ: [0, -2.9, '上海火车站', 'Shanghai Railway Station', 1],
  HZL: [0, -1.1, '汉中路', 'Hanzhong Road', 2],
  RMGC: [0, 0, '人民广场', "People's Square", 1],
  HPNL: [-0.9, 0.9, '黄陂南路', 'South Huangpi Road', 4],
  SXNL: [-1.8, 1.8, '陕西南路', 'South Shaanxi Road', 2],
  CSL: [-2.4, 2.4, '常熟路', 'Changshu Road', 3],
  XJH: [-3.3, 3.3, '徐家汇', 'Xujiahui', 1],
  TYG: [-3.3, 4.5, '上海体育馆', 'Shanghai Indoor Stadium', 2],
  CBL: [-3.3, 5.5, '漕宝路', 'Caobao Road', 2],
  SHNZ: [-3.3, 6.5, '上海南站', 'Shanghai South Railway Station', 1],
  JJLY: [-4.1, 7.3, '锦江乐园', 'Jinjiang Park', 3],
  LHL: [-4.8, 8.0, '莲花路', 'Lianhua Road', 4],
  XZ: [-5.8, 9.0, '莘庄', 'Xinzhuang', 1],
  // ---- Line 2
  XJD: [-13.4, 0, '徐泾东', 'East Xujing', 3],
  HQZ: [-11.6, 0, '虹桥火车站', 'Hongqiao Railway Station', 1],
  HQ2: [-10.2, 0, '虹桥2号航站楼', 'Hongqiao Airport Terminal 2', 2],
  SHL: [-8.4, 0, '淞虹路', 'Songhong Road', 4],
  LSGL: [-6.2, 0, '娄山关路', 'Loushanguan Road', 2],
  ZSGY: [-4.4, 0, '中山公园', 'Zhongshan Park', 1],
  JSL: [-3.4, 0, '江苏路', 'Jiangsu Road', 2],
  JAS: [-2.4, 0, '静安寺', "Jing'an Temple", 1],
  NJXL: [-1.1, 0, '南京西路', 'West Nanjing Road', 2],
  NJDL: [1.0, 0, '南京东路', 'East Nanjing Road', 2],
  LJZ: [2.9, 0, '陆家嘴', 'Lujiazui', 1],
  DCL: [3.6, 0, '东昌路', 'Dongchang Road', 4],
  SJDD: [4.4, 0.1, '世纪大道', 'Century Avenue', 1],
  KJG: [5.4, 1.0, '上海科技馆', 'Science and Technology Museum', 4],
  LYL: [6.6, 2.2, '龙阳路', 'Longyang Road', 1],
  ZJGK: [8.1, 2.2, '张江高科', 'Zhangjiang Hi-Tech Park', 3],
  GLL: [9.6, 2.2, '广兰路', 'Guanglan Road', 3],
  CS: [12.0, 2.2, '川沙', 'Chuansha', 4],
  PDJC: [15.0, 5.2, '浦东国际机场', 'Pudong International Airport', 1],
  // ---- Line 3 / 4 corridor
  LCL: [-2.7, 5.5, '龙漕路', 'Longcao Road', 2],
  SLL: [-2.7, 6.0, '石龙路', 'Shilong Road', 4],
  YSL: [-4.4, 3.7, '宜山路', 'Yishan Road', 2],
  HQL: [-4.4, 2.4, '虹桥路', 'Hongqiao Road', 2],
  YAXL: [-4.4, 1.2, '延安西路', 'West Yan\'an Road', 3],
  JSJL: [-4.4, -1.1, '金沙江路', 'Jinshajiang Road', 2],
  CYL: [-4.4, -2.1, '曹杨路', 'Caoyang Road', 2],
  ZPL: [-3.0, -2.9, '镇坪路', 'Zhenping Road', 2],
  ZTL: [-1.5, -2.9, '中潭路', 'Zhongtan Road', 3],
  BSL: [1.0, -2.9, '宝山路', 'Baoshan Road', 3],
  HKZQ: [2.0, -4.0, '虹口足球场', 'Hongkou Football Stadium', 2],
  JWZ: [2.0, -6.2, '江湾镇', 'Jiangwan Town', 4],
  CJNL: [2.0, -8.0, '长江南路', 'South Changjiang Road', 2],
  JYBL: [2.0, -10.6, '江杨北路', 'North Jiangyang Road', 3],
  HLL: [2.0, -2.8, '海伦路', 'Hailun Road', 2],
  DLL: [3.0, -2.8, '大连路', 'Dalian Road', 2],
  PDDD: [4.3, -1.0, '浦东大道', 'Pudong Avenue', 2],
  LCL2: [4.4, 3.2, '蓝村路', 'Lancun Road', 2],
  XZNL: [0.6, 3.9, '西藏南路', 'South Xizang Road', 2],
  DMQL: [-1.8, 3.9, '大木桥路', 'Damuqiao Road', 2],
  DAL: [-2.4, 3.9, '东安路', "Dong'an Road", 2],
  // ---- Line 5
  DCL5: [-5.8, 12.0, '东川路', 'Dongchuan Road', 3],
  MHKF: [-5.8, 13.4, '闵行开发区', 'Minhang Development Zone', 3],
  FXXC: [-1.4, 16.4, '奉贤新城', 'Fengxian Xincheng', 3],
  // ---- Line 6
  GCL: [9.0, -10.6, '港城路', 'Gangcheng Road', 3],
  JFL: [7.9, -3.4, '巨峰路', 'Jufeng Road', 2],
  MSL: [6.1, -1.6, '民生路', 'Minsheng Road', 2],
  GKXL: [4.5, 5.8, '高科西路', 'West Gaoke Road', 2],
  DMLU: [1.7, 8.6, '东明路', 'Dongming Road', 2],
  DFTY: [0.6, 9.5, '东方体育中心', 'Oriental Sports Center', 1],
  // ---- Line 7
  MLH: [-6.4, -11.4, '美兰湖', 'Meilan Lake', 3],
  CSL7: [-2.4, -1.1, '长寿路', 'Changshou Road', 2],
  LHZL: [-2.4, 4.7, '龙华中路', 'Middle Longhua Road', 2],
  YHL: [0.6, 7.7, '耀华路', 'Yaohua Road', 2],
  CQL: [1.5, 7.7, '长清路', 'Changqing Road', 2],
  HXL: [8.8, 5.2, '花木路', 'Huamu Road', 3],
  // ---- Line 8
  SGL: [6.6, -7.4, '市光路', 'Shiguang Road', 3],
  JPL: [4.0, -4.8, '江浦路', 'Jiangpu Road', 2],
  SPL: [3.2, -4.0, '四平路', 'Siping Road', 2],
  QFL: [0.6, -1.1, '曲阜路', 'Qufu Road', 2],
  LXM: [0.6, 1.8, '老西门', 'Laoximen', 2],
  LJBL: [0.6, 3.3, '陆家浜路', 'Lujiabang Road', 2],
  ZHYSG: [0.6, 7.0, '中华艺术宫', 'China Art Museum', 3],
  CSL8: [0.6, 8.6, '成山路', 'Chengshan Road', 2],
  SDGL: [0.6, 12.6, '沈杜公路', 'Shendu Highway', 3],
  // ---- Line 9
  SJNZ: [-15.0, 10.4, '松江南站', 'Songjiang South Railway Station', 3],
  QB: [-8.6, 3.7, '七宝', 'Qibao', 3],
  ZJBL: [-2.4, 3.3, '肇嘉浜路', 'Zhaojiabang Road', 2],
  JSL9: [-1.8, 3.3, '嘉善路', 'Jiashan Road', 2],
  MDL: [-0.3, 3.3, '马当路', 'Madang Road', 2],
  SCL: [2.6, 1.9, '商城路', 'Shangcheng Road', 4],
  YGZL: [6.1, 0.3, '杨高中路', 'Middle Yanggao Road', 2],
  JHL: [10.4, 0.3, '金海路', 'Jinhai Road', 2],
  CL: [12.6, -1.9, '曹路', 'Caolu', 3],
  // ---- Line 10
  XJWC: [3.2, -9.0, '新江湾城', 'Xinjiangwan City', 3],
  WJC: [3.2, -6.0, '五角场', 'Wujiaochang', 3],
  TTL: [1.0, -1.1, '天潼路', 'Tiantong Road', 2],
  YY: [1.0, 0.9, '豫园', 'Yuyuan Garden', 2],
  XTD: [-0.3, 1.8, '新天地', 'Xintiandi', 2],
  JTDX: [-3.4, 1.8, '交通大学', 'Jiaotong University', 2],
  HQ1: [-9.2, 2.4, '虹桥1号航站楼', 'Hongqiao Airport Terminal 1', 3],
  JTL: [-7.6, 3.6, '航中路', 'Hangzhong Road', 3],
  // ---- Line 11
  JDB: [-12.6, -10.4, '嘉定北', 'North Jiading', 3],
  HQ11: [-14.4, -5.6, '花桥', 'Huaqiao', 3],
  SHXZ: [-6.2, -3.4, '上海西站', 'Shanghai West Railway Station', 2],
  LDL: [-3.4, -1.1, '隆德路', 'Longde Road', 2],
  LH: [-1.8, 5.5, '龙华', 'Longhua', 2],
  DSN: [6.6, 9.8, '迪士尼', 'Disney Resort', 3],
  GLL9: [-6.2, 3.7, '桂林路', 'Guilin Road', 2],
  DDHL: [-6.2, -1.1, '大渡河路', 'Daduhe Road', 2],
  // ---- Line 12
  QXL: [-9.6, 5.5, '七莘路', 'Qixin Road', 3],
  // ---- Line 13
  JYL: [-11.0, -1.1, '金运路', 'Jinyun Road', 3],
  ZRBWG: [-1.8, -1.5, '自然博物馆', 'Natural History Museum', 4],
  SBDD: [1.5, 6.0, '世博大道', 'Expo Avenue', 3],
  ZKL: [6.8, 8.6, '张江路', 'Zhangjiang Road', 3],
  // ---- Line 14
  FL: [-10.6, -2.9, '封浜', 'Fengbang', 3],
  ZR: [-5.2, -2.9, '真如', 'Zhenru', 2],
  DSJ: [0.6, 0.9, '大世界', 'Great World', 2],
  GQL: [11.0, -1.0, '桂桥路', 'Guiqiao Road', 3],
  // ---- Line 15
  GCGY: [-6.6, -9.4, '顾村公园', 'Gucun Park', 3],
  ZZGX: [-6.6, 11.4, '紫竹高新区', 'Zizhu Hi-tech Park', 3],
  // ---- Line 16
  DSH: [14.6, 11.4, '滴水湖', 'Dishui Lake', 3],
  // ---- Line 17
  DFL: [-17.4, 2.4, '东方绿舟', 'Oriental Land', 3],
  // ---- Line 18
  YSH: [9.2, 13.2, '航头', 'Hangtou', 3],
  // ---- Airport link
  HJ: [-2.0, 9.3, '华泾', 'Huajing', 3],
  SLN: [2.6, 10.6, '三林南', 'South Sanlin', 3],
  ZJZ: [6.8, 10.6, '张江', 'Zhangjiang', 3],
  DJQ: [9.6, 10.6, '度假区', 'Resort', 3],
  // ---- Pujiang line
  SHGZ: [2.0, 15.6, '汇臻路', 'Huizhen Road', 3],
};

// colours: official line colours of the network (as published on the operator's maps, approximated for print)
const LINES = [
  { id: '1', color: '#E3002B', route: ['XZ', 'LHL', 'JJLY', 'SHNZ', 'CBL', 'TYG', 'XJH', 'CSL', 'SXNL', 'HPNL', 'RMGC', 'HZL', 'SHZ', 'YCL', 'PPXC', 'GFXC', 'FJL'] },
  { id: '2', ink: true, color: '#82BF25', route: ['XJD', ['HQZ', 0, -0.08], ['HQ2', 0, -0.08], 'SHL', 'LSGL', 'ZSGY', 'JSL', 'JAS', 'NJXL', 'RMGC', 'NJDL', 'LJZ', 'DCL', ['SJDD', 0, -0.1], 'KJG', 'LYL', 'ZJGK', 'GLL', 'CS', 'PDJC'] },
  { id: '3', ink: true, color: '#FCD600', route: ['SHNZ', [-2.7, 5.9], 'SLL', 'LCL', ['YSL', -0.1, 0], ['HQL', -0.1, 0], ['YAXL', -0.1, 0], ['ZSGY', -0.1, 0], ['JSJL', -0.1, 0], ['CYL', -0.1, 0], [-4.5, -2.5], [-4.1, -2.9], ['ZPL', 0, -0.1], ['ZTL', 0, -0.1], ['SHZ', 0, -0.1], ['BSL', 0, -0.1], 'HKZQ', 'JWZ', 'CJNL', 'JYBL'] },
  { id: '4', color: '#461D84', loop: true, route: [['YSL', 0.1, 0], ['HQL', 0.1, 0], ['YAXL', 0.1, 0], ['ZSGY', 0.1, 0], ['JSJL', 0.1, 0], ['CYL', 0.1, 0], [-4.3, -2.5], [-4.0, -2.8], ['ZPL', 0, 0.1], ['ZTL', 0, 0.1], ['SHZ', 0, 0.1], ['BSL', 0, 0.1], 'HLL', 'DLL', [3.8, -2.8], [4.3, -2.3], 'PDDD', ['SJDD', -0.1, 0], [4.3, 2.0], ['LCL2', -0.1, 0], [3.6, 3.9], [2.9, 3.9], 'XZNL', 'DMQL', 'DAL', [-3.0, 4.5], 'TYG', [-3.5, 4.5], ['YSL', 0.1, 0]] },
  { id: '5', color: '#944D9A', route: ['XZ', 'DCL5', 'MHKF'], branch: ['DCL5', [-5.8, 12.4], [-2.2, 16.0], [-1.8, 16.4], 'FXXC'] },
  { id: '6', color: '#D40068', route: ['GCL', [9.0, -4.5], 'JFL', 'MSL', [4.5, 0.0], ['SJDD', 0.1, 0], [4.5, 2.0], ['LCL2', 0.1, 0], 'GKXL', 'DMLU', [0.8, 9.5], 'DFTY'] },
  { id: '7', color: '#ED6F00', route: ['MLH', [-6.4, -8.8], [-3.0, -5.4], [-3.0, -2.9], 'ZPL', [-2.4, -2.3], 'CSL7', 'JAS', 'CSL', 'ZJBL', 'DAL', 'LHZL', 'YHL', 'CQL', [2.4, 7.7], [4.4, 5.7], 'GKXL', [7.1, 3.2], [7.1, 2.6], 'LYL', [8.8, 4.4], 'HXL'] },
  { id: '8', color: '#0094D8', route: ['SGL', 'JPL', 'SPL', 'HKZQ', [1.2, -4.0], [0.6, -3.4], 'QFL', [0.6, -0.6], 'RMGC', [0.6, 0.6], 'DSJ', 'LXM', 'LJBL', 'XZNL', 'ZHYSG', 'YHL', 'CSL8', 'DFTY', 'SDGL'] },
  { id: '9', ink: true, color: '#87CAED', route: ['SJNZ', [-9.6, 4.8], 'QB', 'GLL9', ['YSL', 0, 0], 'XJH', 'ZJBL', 'JSL9', 'MDL', 'LJBL', [1.2, 3.3], 'SCL', [4.2, 0.3], ['SJDD', 0, 0.2], 'YGZL', 'JHL', [10.6, 0.3], 'CL'] },
  { id: '10', ink: true, color: '#C6AFD4', route: ['XJWC', 'WJC', 'SPL', 'HLL', [1.0, -1.8], 'TTL', 'NJDL', 'YY', [1.0, 1.4], 'LXM', 'XTD', 'SXNL', 'JTDX', [-3.8, 2.4], 'HQL', 'HQ1', [-10.2, 1.4], ['HQ2', 0, 0.12], ['HQZ', 0, 0.12]], branch: ['HQ1', [-7.6, 2.4], 'JTL'] },
  { id: '11', color: '#871C2B', route: ['JDB', [-12.6, -9.6], 'SHXZ', 'ZR', 'CYL', 'LDL', 'JSL', 'JTDX', ['XJH', -0.1, 0], [-2.6, 4.1], [-2.6, 4.7], 'LH', [-0.4, 6.9], '/', [0.6, 8.5], 'DFTY', [1.4, 9.6], [4.0, 9.6], 'DSN'], branch: ['HQ11', [-12.4, -3.6], [-11.6, -2.8], 'SHXZ'] },
  { id: '12', color: '#007A60', route: ['QXL', 'CBL', 'LCL', 'LH', [-1.8, 4.7], 'DMQL', 'JSL9', 'SXNL', [-1.8, 0.7], 'NJXL', 'HZL', 'QFL', 'TTL', [2.2, -2.3], [2.5, -2.3], 'DLL', [3.6, -3.4], 'JFL', [10.4, -3.4], 'JHL'] },
  { id: '13', ink: true, color: '#E999C0', route: ['JYL', 'DDHL', 'JSJL', 'LDL', 'CSL7', ['HZL', 0, 0], [0.1, -1.0], ['NJXL', 0.1, 0.1], [-1.0, 1.1], [-0.3, 1.8], 'XTD', 'MDL', [-0.3, 4.2], 'SBDD', 'CQL', 'CSL8', 'DMLU', [6.0, 8.6], 'ZKL'] },
  { id: '14', color: '#626020', route: ['FL', [-5.8, -2.9], 'ZR', [-4.3, -2.1], [-2.4, -0.2], [-1.3, 0.9], 'HPNL', 'DSJ', 'YY', [2.0, 0.9], 'LJZ', [3.9, -1.0], 'PDDD', [10.0, -1.0], 'GQL'] },
  { id: '15', ink: true, color: '#BCA886', route: ['GCGY', [-6.6, -3.6], [-6.2, -3.2], 'DDHL', 'LSGL', 'GLL9', [-6.2, 4.0], [-3.7, 6.5], 'SHNZ', [-3.3, 8.0], 'ZZGX'] },
  { id: '16', ink: true, color: '#98D1C0', route: ['LYL', [7.6, 3.2], [7.6, 4.8], [14.6, 11.8], 'DSH'] },
  { id: '17', color: '#BC796F', route: ['HQZ', [-12.6, 0], [-15.0, 2.4], 'DFL'] },
  { id: '18', color: '#C4984F', route: ['CJNL', [3.0, -8.0], [4.0, -7.0], 'JPL', [6.1, -2.7], 'MSL', 'YGZL', [6.1, 1.7], 'LYL', [6.6, 6.6], 'YSH'] },
  { id: 'P', name: '浦江线', bullet: '浦江', ink: false, color: '#B5B5B6', route: ['DFTY', [0.6, 10.2], [2.0, 11.6], 'SHGZ'] },
  { id: 'M', name: '磁浮', bullet: '磁浮', mode: 'light', color: '#008B9A', route: ['LYL', [6.6, 2.8], [12.6, 2.8], 'PDJC'] },
  { id: 'A', name: '机场联络线', bullet: '机场', color: '#3D688A', route: [['HQZ', 0, 0.12], [-11.6, 0.7], 'QB', [-3.0, 9.3], 'HJ', [0.2, 9.3], [1.4, 10.6], 'SLN', 'ZJZ', 'DJQ', ['PDJC', 0, 0.1]] },
];

// the Huangpu: Bund stretch north, bend east round Lujiazui, out to the Yangtze (top right)
const RIVER = [[-19, 14.4], [-6.0, 14.4], [-1.0, 9.4], [-1.0, 8.2], [2.0, 5.2], [2.0, -1.6], [5.0, -1.6], [8.0, -4.6], [8.0, -14]];
const SUZHOU = [[2.0, -0.7], [-0.6, -0.7], [-1.2, -1.3], [-2.0, -1.3], [-2.6, -1.9], [-3.6, -1.9], [-4.4, -1.6], [-7.0, -1.6]]; // Suzhou Creek (thin)

// resolve a route item to a point (grid units)
function pt(it) {
  if (typeof it === 'string') { const s = ST[it]; if (!s) throw new Error('no station ' + it); return [s[0], s[1]]; }
  if (typeof it[0] === 'string') { const s = ST[it[0]]; if (!s) throw new Error('no station ' + it[0]); return [s[0] + it[1], s[1] + it[2]]; }
  return [it[0], it[1]];
}
const sid = it => typeof it === 'string' ? it : (typeof it[0] === 'string' ? it[0] : null);
// expand a route into an octilinear polyline: between two points that are not on one of the 8 directions,
// insert a bend: straight first then diagonal (default), or diagonal first when the item is preceded by '/'.
function expand(route) {
  const out = [], ids = []; let diagFirst = false;
  for (const it of route) {
    if (it === '/') { diagFirst = true; continue; }
    const p = pt(it);
    if (out.length) {
      const a = out[out.length - 1], dx = p[0] - a[0], dy = p[1] - a[1], ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax > 1e-6 && ay > 1e-6 && Math.abs(ax - ay) > 1e-6) {
        const d = Math.min(ax, ay), sx = Math.sign(dx), sy = Math.sign(dy);
        const bend = diagFirst ? [a[0] + sx * d, a[1] + sy * d] : [p[0] - sx * d, p[1] - sy * d];
        out.push(bend); ids.push(null);
      }
    }
    out.push(p); ids.push(sid(it)); diagFirst = false;
  }
  return { pts: out, ids };
}
// water for the engine: bands (rivers, creeks: a centre line and two widths in G) and areas (sea, bay, harbour, lake:
// a closed octilinear outline); tunnel: true makes lines crossing it run dashed underneath
const WATER = [
  { id: 'huangpu', line: RIVER, outer: 0.81, inner: 0.75, tunnel: true },
  { id: 'suzhou', line: SUZHOU, outer: 0.15, inner: 0.11 },
];
const LINKS = [];   // walking transfers: {a, b} inside a station complex, {a, b, out: true} through the street
window.NET = { G, ST, LINES, WATER, LINKS, pt, sid, expand };
})();
