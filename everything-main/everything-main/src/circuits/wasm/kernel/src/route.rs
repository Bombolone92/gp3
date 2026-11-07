//! Grid-based multi-layer autorouter.
//!
//! The board is rasterized into cells on every copper layer. A cell holds
//! the net that may use it (-1 free, -2 blocked, n owned by net n). Each
//! connection of the minimum spanning tree of a net's unconnected copper
//! islands is routed with A* (8 directions, via transitions with a cost),
//! then committed so later connections route around it.

use crate::shape::*;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, VecDeque};

const DIRS: [(i32, i32); 8] = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)];
const SEED: u8 = 255;
const FREE: i32 = -1;
const BLOCKED: i32 = -2;

pub struct RouteParams {
    pub grid: f64,
    /// Copper layer bits present on the board, top to bottom.
    pub layers: Vec<u32>,
    /// Bit mask of layers the router may use.
    pub allowed: u32,
    pub clearance: f64,
    pub via_r: f64,
    pub via_cost: f64,
    pub edge_clearance: f64,
    /// Half track width per net index.
    pub net_hw: Vec<f64>,
    pub default_hw: f64,
    /// Nets to route (empty: all).
    pub nets: Vec<i32>,
    pub max_nodes: usize,
    /// Connection order: 0 shortest first, 1 longest first, 2 busiest nets
    /// first, 3 and up a seeded shuffle (several passes try different orders).
    pub order: u32,
}

#[derive(Clone, Copy)]
struct Conn {
    net: i32,
    a: usize,
    b: usize,
    pa: [f64; 2],
    pb: [f64; 2],
    len: f64,
}

pub struct Track {
    pub layer: u32,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub w: f64,
    pub net: i32,
}

pub struct Failed {
    pub net: i32,
    pub a: [f64; 2],
    pub b: [f64; 2],
}

pub struct Router {
    p: RouteParams,
    shapes: Vec<Shape>,
    nx: usize,
    ny: usize,
    nl: usize,
    ox: f64,
    oy: f64,
    g: f64,
    hw_max: f64,
    margin: f64,
    owner: Vec<i32>,
    cover: Vec<i32>,
    gcost: Vec<u32>,
    seen: Vec<u32>,
    from: Vec<u8>,
    gen: u32,
    via_disk: Vec<(i32, i32)>,
    parent: Vec<usize>,
    cells: Vec<Vec<u32>>,
    ibox: Vec<[i32; 4]>,
    queue: VecDeque<Conn>,
    retry: Vec<Conn>,
    retried: bool,
    via_cost: u32,
    pub total: usize,
    /// Connections to route, before any retries.
    pub initial: usize,
    pub processed: usize,
    pub routed: usize,
    pub tracks: Vec<Track>,
    pub vias: Vec<([f64; 2], i32)>,
    pub failed: Vec<Failed>,
}

impl Router {
    pub fn new(shapes: Vec<Shape>, board: &[Vec<[f64; 2]>], mut p: RouteParams) -> Router {
        let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        let src: Vec<[f64; 2]> = if !board.is_empty() && board[0].len() >= 3 {
            board[0].clone()
        } else {
            shapes.iter().filter(|s| s.is_copper()).flat_map(|s| [[s.bbox[0], s.bbox[1]], [s.bbox[2], s.bbox[3]]]).collect()
        };
        for q in &src {
            b[0] = b[0].min(q[0]);
            b[1] = b[1].min(q[1]);
            b[2] = b[2].max(q[0]);
            b[3] = b[3].max(q[1]);
        }
        if !b[0].is_finite() {
            b = [0.0, 0.0, 1.0, 1.0];
        }
        let nl = p.layers.len().max(1);
        let mut g = p.grid.max(10_000.0);
        let w = b[2] - b[0];
        let h = b[3] - b[1];
        let max_nodes = p.max_nodes.max(10_000) as f64;
        if (w / g + 3.0) * (h / g + 3.0) * nl as f64 > max_nodes {
            g = ((w * h * nl as f64) / max_nodes).sqrt() * 1.05;
        }
        p.grid = g;
        let ox = (b[0] / g).floor() * g - g;
        let oy = (b[1] / g).floor() * g - g;
        let nx = ((b[2] - ox) / g).ceil() as usize + 2;
        let ny = ((b[3] - oy) / g).ceil() as usize + 2;
        let n = nx * ny * nl;
        let hw_max = p.net_hw.iter().cloned().fold(p.default_hw, f64::max);
        let margin = g * 0.15;
        let rv = ((p.via_r - hw_max - margin).max(0.0) / g).ceil() as i32;
        let mut via_disk = Vec::new();
        let rr = (p.via_r - hw_max).max(0.0) / g;
        for dy in -rv..=rv {
            for dx in -rv..=rv {
                if ((dx * dx + dy * dy) as f64).sqrt() <= rr + 0.5 {
                    via_disk.push((dx, dy));
                }
            }
        }
        if via_disk.is_empty() {
            via_disk.push((0, 0));
        }
        let ns = shapes.len();
        let mut r = Router {
            via_cost: (p.via_cost.max(1.0) * 10.0) as u32,
            p, shapes, nx, ny, nl, ox, oy, g, hw_max, margin,
            owner: vec![FREE; n], cover: vec![-1; n], gcost: vec![0; n], seen: vec![0; n], from: vec![0; n], gen: 0,
            via_disk, parent: (0..ns).collect(), cells: vec![Vec::new(); ns], ibox: vec![[i32::MAX, i32::MAX, i32::MIN, i32::MIN]; ns],
            queue: VecDeque::new(), retry: Vec::new(), retried: false,
            total: 0, initial: 0, processed: 0, routed: 0, tracks: Vec::new(), vias: Vec::new(), failed: Vec::new(),
        };
        r.block_board(board);
        r.rasterize_shapes();
        r.union_overlaps();
        r.build_connections();
        r
    }

    fn layer_index(&self, bit: u32) -> Option<usize> {
        self.p.layers.iter().position(|&l| l == bit)
    }

    #[inline]
    fn node(&self, l: usize, ix: usize, iy: usize) -> usize {
        (l * self.ny + iy) * self.nx + ix
    }

    fn center(&self, ix: usize, iy: usize) -> [f64; 2] {
        [self.ox + (ix as f64 + 0.5) * self.g, self.oy + (iy as f64 + 0.5) * self.g]
    }

    fn cell_range(&self, b: [f64; 4]) -> (usize, usize, usize, usize) {
        let fx = |v: f64| (((v - self.ox) / self.g - 0.5).floor().max(0.0) as usize).min(self.nx - 1);
        let fy = |v: f64| (((v - self.oy) / self.g - 0.5).floor().max(0.0) as usize).min(self.ny - 1);
        let cx = |v: f64| (((v - self.ox) / self.g - 0.5).ceil().max(0.0) as usize).min(self.nx - 1);
        let cy = |v: f64| (((v - self.oy) / self.g - 0.5).ceil().max(0.0) as usize).min(self.ny - 1);
        (fx(b[0]), fy(b[1]), cx(b[2]), cy(b[3]))
    }

    /// Calls f(ix, iy) for every cell whose center is within `inflate` of the shape.
    fn raster(&self, s: &Shape, inflate: f64, f: &mut dyn FnMut(usize, usize)) {
        let b = [s.bbox[0] - inflate, s.bbox[1] - inflate, s.bbox[2] + inflate, s.bbox[3] + inflate];
        let (x0, y0, x1, y1) = self.cell_range(b);
        if s.kind != KIND_POLY || s.pts.len() <= 8 {
            for iy in y0..=y1 {
                for ix in x0..=x1 {
                    if point_distance(s, self.center(ix, iy)) <= inflate {
                        f(ix, iy);
                    }
                }
            }
            return;
        }
        // Large polygons: scanline for the interior, capsules along the edges.
        for iy in y0..=y1 {
            let y = self.center(0, iy)[1];
            let mut xs: Vec<f64> = Vec::new();
            for &(a, bb) in &s.rings {
                let mut j = bb - 1;
                for k in a..bb {
                    let (p0, p1) = (s.pts[j], s.pts[k]);
                    if (p0[1] > y) != (p1[1] > y) {
                        xs.push(p0[0] + (y - p0[1]) * (p1[0] - p0[0]) / (p1[1] - p0[1]));
                    }
                    j = k;
                }
            }
            xs.sort_by(|a, c| a.partial_cmp(c).unwrap());
            for pair in xs.chunks(2) {
                if pair.len() < 2 {
                    break;
                }
                let (cx0, _, cx1, _) = self.cell_range([pair[0], y, pair[1], y]);
                for ix in cx0..=cx1 {
                    let x = self.center(ix, iy)[0];
                    if x >= pair[0] && x <= pair[1] {
                        f(ix, iy);
                    }
                }
            }
        }
        if inflate > 0.0 {
            for &(a, bb) in &s.rings {
                let mut j = bb - 1;
                for k in a..bb {
                    let seg = seg_shape(s.pts[j], s.pts[k], 0.0);
                    self.raster(&seg, inflate, f);
                    j = k;
                }
            }
        }
    }

    fn block_board(&mut self, board: &[Vec<[f64; 2]>]) {
        if board.is_empty() || board[0].len() < 3 {
            return;
        }
        let mut pts = Vec::new();
        let mut rings = Vec::new();
        for r in board {
            let s = pts.len();
            pts.extend_from_slice(r);
            rings.push((s, pts.len()));
        }
        let plane = self.nx * self.ny;
        for iy in 0..self.ny {
            for ix in 0..self.nx {
                if !point_in_rings(self.center(ix, iy), &pts, &rings) {
                    for l in 0..self.nl {
                        self.owner[l * plane + iy * self.nx + ix] = BLOCKED;
                    }
                }
            }
        }
        let inflate = self.p.edge_clearance + self.hw_max + self.margin;
        let mut hits = Vec::new();
        for r in board {
            for k in 0..r.len() {
                let seg = seg_shape(r[k], r[(k + 1) % r.len()], 0.0);
                self.raster(&seg, inflate, &mut |ix, iy| hits.push((ix, iy)));
            }
        }
        for (ix, iy) in hits {
            for l in 0..self.nl {
                self.owner[l * plane + iy * self.nx + ix] = BLOCKED;
            }
        }
    }

    fn mark(&mut self, l: usize, ix: usize, iy: usize, net: i32) {
        let n = self.node(l, ix, iy);
        let cur = self.owner[n];
        self.owner[n] = if net < 0 || cur == BLOCKED { BLOCKED } else if cur == FREE || cur == net { net } else { BLOCKED };
    }

    fn rasterize_shapes(&mut self) {
        let shapes = std::mem::take(&mut self.shapes);
        let cover_thr = self.g * 0.35;
        for (si, s) in shapes.iter().enumerate() {
            if s.flags & (F_COURTYARD | F_EDGE) != 0 {
                continue;
            }
            let layers: Vec<usize> = (0..self.nl).filter(|&l| s.mask & (1 << self.p.layers[l]) != 0).collect();
            if layers.is_empty() {
                continue;
            }
            let keep = s.flags & F_KEEPOUT != 0;
            let inflate = if keep { self.hw_max + self.margin } else { s.clr.max(self.p.clearance) + self.hw_max + self.margin };
            let net = if keep { -2 } else { s.net };
            let mut hits = Vec::new();
            self.raster(s, inflate, &mut |ix, iy| hits.push((ix, iy)));
            for &(ix, iy) in &hits {
                for &l in &layers {
                    self.mark(l, ix, iy, net);
                }
            }
            if keep || s.net < 0 {
                continue;
            }
            // Cells on the copper itself: sources and targets for routing.
            let mut covered = Vec::new();
            self.raster(s, cover_thr, &mut |ix, iy| covered.push((ix, iy)));
            if covered.is_empty() {
                let (x0, y0, _, _) = self.cell_range([s.cx, s.cy, s.cx, s.cy]);
                covered.push((x0, y0));
            }
            for (ix, iy) in covered {
                for &l in &layers {
                    let n = self.node(l, ix, iy);
                    if self.owner[n] == s.net && self.cover[n] < 0 {
                        self.cover[n] = si as i32;
                        self.cells[si].push(n as u32);
                        let bx = &mut self.ibox[si];
                        bx[0] = bx[0].min(ix as i32);
                        bx[1] = bx[1].min(iy as i32);
                        bx[2] = bx[2].max(ix as i32);
                        bx[3] = bx[3].max(iy as i32);
                    }
                }
            }
        }
        self.shapes = shapes;
    }

    fn find(&mut self, mut x: usize) -> usize {
        while self.parent[x] != x {
            self.parent[x] = self.parent[self.parent[x]];
            x = self.parent[x];
        }
        x
    }

    fn union(&mut self, a: usize, b: usize) -> usize {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra == rb {
            return ra;
        }
        let (big, small) = if self.cells[ra].len() >= self.cells[rb].len() { (ra, rb) } else { (rb, ra) };
        self.parent[small] = big;
        let moved = std::mem::take(&mut self.cells[small]);
        self.cells[big].extend(moved);
        let sb = self.ibox[small];
        let bb = &mut self.ibox[big];
        bb[0] = bb[0].min(sb[0]);
        bb[1] = bb[1].min(sb[1]);
        bb[2] = bb[2].max(sb[2]);
        bb[3] = bb[3].max(sb[3]);
        big
    }

    /// Joins same-net copper that already touches.
    fn union_overlaps(&mut self) {
        let mut idx: Vec<usize> = (0..self.shapes.len()).filter(|&i| self.shapes[i].net >= 0 && self.shapes[i].is_copper()).collect();
        idx.sort_by(|&a, &b| {
            let (sa, sb) = (&self.shapes[a], &self.shapes[b]);
            sa.net.cmp(&sb.net).then(sa.bbox[0].partial_cmp(&sb.bbox[0]).unwrap())
        });
        let mut pairs = Vec::new();
        for x in 0..idx.len() {
            let a = &self.shapes[idx[x]];
            for &j in &idx[x + 1..] {
                let b = &self.shapes[j];
                if b.net != a.net || b.bbox[0] > a.bbox[2] {
                    break;
                }
                if a.mask & b.mask & COPPER_MASK == 0 || !boxes_overlap(&a.bbox, &b.bbox, 0.0) {
                    continue;
                }
                if gap(a, b, 1.0).0 <= 0.0 {
                    pairs.push((idx[x], j));
                }
            }
        }
        for (a, b) in pairs {
            self.union(a, b);
        }
    }

    fn build_connections(&mut self) {
        let wanted = |net: i32, nets: &Vec<i32>| nets.is_empty() || nets.contains(&net);
        // Pad centers per island, grouped by net.
        let mut by_net: Vec<(i32, usize, [f64; 2])> = Vec::new();
        for i in 0..self.shapes.len() {
            let s = &self.shapes[i];
            if s.flags & F_PAD == 0 || s.net < 0 || !wanted(s.net, &self.p.nets) {
                continue;
            }
            let (net, c) = (s.net, [s.cx, s.cy]);
            let root = self.find(i);
            by_net.push((net, root, c));
        }
        by_net.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        let mut conns = Vec::new();
        let mut start = 0;
        while start < by_net.len() {
            let net = by_net[start].0;
            let mut end = start;
            while end < by_net.len() && by_net[end].0 == net {
                end += 1;
            }
            // Islands of this net and their pads.
            let mut islands: Vec<(usize, Vec<[f64; 2]>)> = Vec::new();
            for &(_, root, c) in &by_net[start..end] {
                match islands.last_mut() {
                    Some((r, v)) if *r == root => v.push(c),
                    _ => islands.push((root, vec![c])),
                }
            }
            // Prim's minimum spanning tree over islands.
            let k = islands.len();
            if k > 1 {
                let mut in_tree = vec![false; k];
                let mut best = vec![(f64::INFINITY, 0usize, [0.0; 2], [0.0; 2]); k];
                in_tree[0] = true;
                let closest = |a: &Vec<[f64; 2]>, b: &Vec<[f64; 2]>| {
                    let mut r = (f64::INFINITY, [0.0; 2], [0.0; 2]);
                    for p in a {
                        for q in b {
                            let d = ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt();
                            if d < r.0 {
                                r = (d, *p, *q);
                            }
                        }
                    }
                    r
                };
                for j in 1..k {
                    let (d, p, q) = closest(&islands[0].1, &islands[j].1);
                    best[j] = (d, 0, p, q);
                }
                for _ in 1..k {
                    let mut pick = usize::MAX;
                    for j in 0..k {
                        if !in_tree[j] && (pick == usize::MAX || best[j].0 < best[pick].0) {
                            pick = j;
                        }
                    }
                    in_tree[pick] = true;
                    let (d, from, p, q) = best[pick];
                    conns.push(Conn { net, a: islands[from].0, b: islands[pick].0, pa: p, pb: q, len: d });
                    for j in 0..k {
                        if !in_tree[j] {
                            let (d2, p2, q2) = closest(&islands[pick].1, &islands[j].1);
                            if d2 < best[j].0 {
                                best[j] = (d2, pick, p2, q2);
                            }
                        }
                    }
                }
            }
            start = end;
        }
        conns.sort_by(|a, b| a.len.partial_cmp(&b.len).unwrap().then(a.net.cmp(&b.net)));
        match self.p.order {
            0 => {}
            1 => conns.reverse(),
            2 => {
                let mut size = std::collections::HashMap::new();
                for c in &conns {
                    *size.entry(c.net).or_insert(0usize) += 1;
                }
                conns.sort_by(|a, b| size[&b.net].cmp(&size[&a.net]).then(a.len.partial_cmp(&b.len).unwrap()));
            }
            seed => {
                // Deterministic shuffle (xorshift) so passes are repeatable.
                let mut s: u64 = 0x9E37_79B9_7F4A_7C15 ^ (seed as u64).wrapping_mul(0x2545_F491_4F6C_DD1D);
                for i in (1..conns.len()).rev() {
                    s ^= s << 13;
                    s ^= s >> 7;
                    s ^= s << 17;
                    let j = (s % (i as u64 + 1)) as usize;
                    conns.swap(i, j);
                }
            }
        }
        self.total = conns.len();
        self.initial = conns.len();
        self.queue = conns.into();
    }

    #[inline]
    fn passable(&self, n: usize, net: i32) -> bool {
        let o = self.owner[n];
        o == FREE || o == net
    }

    fn via_ok(&self, ix: usize, iy: usize, net: i32) -> bool {
        for l in 0..self.nl {
            for &(dx, dy) in &self.via_disk {
                let x = ix as i32 + dx;
                let y = iy as i32 + dy;
                if x < 0 || y < 0 || x as usize >= self.nx || y as usize >= self.ny {
                    return false;
                }
                if !self.passable(self.node(l, x as usize, y as usize), net) {
                    return false;
                }
            }
        }
        true
    }

    /// Routes queued connections, at most `budget` of them. Returns how many
    /// remain (including a final retry pass for failures).
    pub fn step(&mut self, budget: usize) -> usize {
        let mut n = 0;
        while n < budget {
            if let Some(c) = self.queue.pop_front() {
                n += 1;
                self.processed += 1;
                if self.route(c) {
                    self.routed += 1;
                } else {
                    self.retry.push(c);
                }
                continue;
            }
            if !self.retried && !self.retry.is_empty() {
                // One more pass for failures, with cheaper vias.
                self.retried = true;
                self.via_cost = (self.via_cost / 2).max(10);
                let again = std::mem::take(&mut self.retry);
                self.total += again.len();
                self.queue.extend(again);
                continue;
            }
            break;
        }
        if self.queue.is_empty() && (self.retried || self.retry.is_empty()) {
            for c in std::mem::take(&mut self.retry) {
                self.failed.push(Failed { net: c.net, a: c.pa, b: c.pb });
            }
            return 0;
        }
        self.queue.len() + if self.retried { 0 } else { self.retry.len() }
    }

    fn route(&mut self, c: Conn) -> bool {
        let (ra, rb) = (self.find(c.a), self.find(c.b));
        if ra == rb {
            return true;
        }
        // Search from the smaller island toward the larger one.
        let (src, dst) = if self.cells[ra].len() <= self.cells[rb].len() { (ra, rb) } else { (rb, ra) };
        if self.cells[src].is_empty() || self.cells[dst].is_empty() {
            return false;
        }
        let sb = self.ibox[src];
        let db = self.ibox[dst];
        let span = ((sb[2].max(db[2]) - sb[0].min(db[0])).max(sb[3].max(db[3]) - sb[1].min(db[1]))) as f64;
        let m = (span * 0.3).max(12.0) as i32;
        let local = [sb[0].min(db[0]) - m, sb[1].min(db[1]) - m, sb[2].max(db[2]) + m, sb[3].max(db[3]) + m];
        let full = [0, 0, self.nx as i32 - 1, self.ny as i32 - 1];
        let path = self.search(src, dst, c.net, local, 1_500_000).or_else(|| {
            if local[0] > 0 || local[1] > 0 || local[2] < full[2] || local[3] < full[3] {
                self.search(src, dst, c.net, full, 4_000_000)
            } else {
                None
            }
        });
        let Some(path) = path else { return false };
        self.commit(&path, c.net, src, dst);
        true
    }

    fn search(&mut self, src: usize, dst: usize, net: i32, region: [i32; 4], limit: usize) -> Option<Vec<usize>> {
        self.gen = self.gen.wrapping_add(1);
        if self.gen == 0 {
            self.seen.iter_mut().for_each(|v| *v = 0);
            self.gen = 1;
        }
        let gen = self.gen;
        let plane = self.nx * self.ny;
        let tb = self.ibox[dst];
        let h = |ix: i32, iy: i32| -> u32 {
            let dx = (tb[0] - ix).max(ix - tb[2]).max(0) as u32;
            let dy = (tb[1] - iy).max(iy - tb[3]).max(0) as u32;
            let (lo, hi) = if dx < dy { (dx, dy) } else { (dy, dx) };
            lo * 14 + (hi - lo) * 10
        };
        let mut heap: BinaryHeap<Reverse<(u32, u32)>> = BinaryHeap::new();
        for &n in &self.cells[src].clone() {
            let n = n as usize;
            if self.find_cover(n) != Some(src) {
                continue;
            }
            let l = n / plane;
            if self.p.allowed & (1 << self.p.layers[l]) == 0 || !self.passable(n, net) {
                continue;
            }
            self.seen[n] = gen;
            self.gcost[n] = 0;
            self.from[n] = SEED;
            let r = n % plane;
            heap.push(Reverse((h((r % self.nx) as i32, (r / self.nx) as i32), n as u32)));
        }
        let mut expanded = 0usize;
        while let Some(Reverse((f, nu))) = heap.pop() {
            let n = nu as usize;
            let l = n / plane;
            let r = n % plane;
            let (ix, iy) = ((r % self.nx) as i32, (r / self.nx) as i32);
            let gcur = self.gcost[n];
            if f > gcur + h(ix, iy) {
                continue; // stale entry
            }
            if self.from[n] != SEED && self.find_cover(n) == Some(dst) {
                return Some(self.trace(n));
            }
            expanded += 1;
            if expanded > limit {
                return None;
            }
            let arrived = self.from[n];
            for (d, &(dx, dy)) in DIRS.iter().enumerate() {
                let (x, y) = (ix + dx, iy + dy);
                if x < region[0] || y < region[1] || x > region[2] || y > region[3] {
                    continue;
                }
                let m = self.node(l, x as usize, y as usize);
                if !self.passable(m, net) {
                    continue;
                }
                if d % 2 == 1 {
                    // No corner cutting past blocked cells.
                    let a = self.node(l, x as usize, iy as usize);
                    let b = self.node(l, ix as usize, y as usize);
                    if !self.passable(a, net) || !self.passable(b, net) {
                        continue;
                    }
                }
                let mut cost = if d % 2 == 1 { 14 } else { 10 };
                if arrived < 8 && arrived as usize != d {
                    cost += 3;
                }
                let ng = gcur + cost;
                if self.seen[m] != gen || ng < self.gcost[m] {
                    self.seen[m] = gen;
                    self.gcost[m] = ng;
                    self.from[m] = d as u8;
                    heap.push(Reverse((ng + h(x, y), m as u32)));
                }
            }
            if self.nl > 1 && self.via_ok(ix as usize, iy as usize, net) {
                for l2 in 0..self.nl {
                    if l2 == l || self.p.allowed & (1 << self.p.layers[l2]) == 0 {
                        continue;
                    }
                    let m = self.node(l2, ix as usize, iy as usize);
                    let ng = gcur + self.via_cost;
                    if self.seen[m] != gen || ng < self.gcost[m] {
                        self.seen[m] = gen;
                        self.gcost[m] = ng;
                        self.from[m] = 8 + l as u8;
                        heap.push(Reverse((ng + h(ix, iy), m as u32)));
                    }
                }
            }
        }
        None
    }

    fn find_cover(&mut self, n: usize) -> Option<usize> {
        let c = self.cover[n];
        if c < 0 { None } else { Some(self.find(c as usize)) }
    }

    fn trace(&self, mut n: usize) -> Vec<usize> {
        let plane = self.nx * self.ny;
        let mut out = vec![n];
        loop {
            let f = self.from[n];
            if f == SEED {
                break;
            }
            let l = n / plane;
            let r = n % plane;
            let (ix, iy) = ((r % self.nx) as i32, (r / self.nx) as i32);
            n = if f >= 8 {
                self.node((f - 8) as usize, ix as usize, iy as usize)
            } else {
                let (dx, dy) = DIRS[f as usize];
                self.node(l, (ix - dx) as usize, (iy - dy) as usize)
            };
            out.push(n);
        }
        out.reverse();
        out
    }

    fn commit(&mut self, path: &[usize], net: i32, src: usize, dst: usize) {
        let plane = self.nx * self.ny;
        let hw = self.p.net_hw.get(net as usize).cloned().unwrap_or(self.p.default_hw);
        let decode = |n: usize| (n / plane, (n % plane) % self.nx, (n % plane) / self.nx);
        // Split into runs on one layer, keeping only corner points.
        let mut segs: Vec<(usize, [f64; 2], [f64; 2])> = Vec::new();
        let mut vias: Vec<[f64; 2]> = Vec::new();
        let mut i = 0;
        while i < path.len() {
            let (l, ix, iy) = decode(path[i]);
            let mut pts = vec![self.center(ix, iy)];
            let mut dir: Option<(i64, i64)> = None;
            let mut j = i + 1;
            let (mut px, mut py) = (ix as i64, iy as i64);
            while j < path.len() {
                let (l2, x2, y2) = decode(path[j]);
                if l2 != l {
                    break;
                }
                let d = (x2 as i64 - px, y2 as i64 - py);
                if dir.is_some() && dir != Some(d) {
                    pts.push(self.center(px as usize, py as usize));
                }
                dir = Some(d);
                px = x2 as i64;
                py = y2 as i64;
                j += 1;
            }
            if j > i + 1 {
                pts.push(self.center(px as usize, py as usize));
            }
            for w in pts.windows(2) {
                segs.push((l, w[0], w[1]));
            }
            if j < path.len() {
                vias.push(self.center(px as usize, py as usize));
            }
            i = j;
        }
        // Stubs from the end cells to pad centers.
        let (fl, fx, fy) = decode(path[0]);
        let (ll, lx, ly) = decode(path[path.len() - 1]);
        let ends = [(path[0], fl, self.center(fx, fy)), (path[path.len() - 1], ll, self.center(lx, ly))];
        for (n, l, c) in ends {
            let sc = self.cover[n];
            if sc >= 0 && (sc as usize) < self.shapes.len() {
                let s = &self.shapes[sc as usize];
                if s.flags & F_PAD != 0 && s.kind != KIND_POLY && (s.cx - c[0]).abs() + (s.cy - c[1]).abs() > 1.0 {
                    segs.push((l, c, [s.cx, s.cy]));
                }
            }
        }
        // Register the new copper as a routed island joined to both ends.
        let id = self.parent.len();
        self.parent.push(id);
        self.cells.push(Vec::new());
        self.ibox.push([i32::MAX, i32::MAX, i32::MIN, i32::MIN]);
        let inflate = self.p.clearance + self.hw_max + self.margin;
        let cover_thr = self.g * 0.35;
        for &(l, a, b) in &segs {
            let s = seg_shape(a, b, hw);
            self.claim(&s, &[l], inflate, cover_thr, net, id);
            self.tracks.push(Track { layer: self.p.layers[l], x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: hw * 2.0, net });
        }
        let all: Vec<usize> = (0..self.nl).collect();
        for v in &vias {
            let mut s = seg_shape(*v, *v, self.p.via_r);
            s.kind = KIND_CIRCLE;
            self.claim(&s, &all, inflate, cover_thr, net, id);
            self.vias.push((*v, net));
        }
        let r = self.union(src, dst);
        self.union(r, id);
    }

    fn claim(&mut self, s: &Shape, layers: &[usize], inflate: f64, cover_thr: f64, net: i32, id: usize) {
        let mut hits = Vec::new();
        self.raster(s, inflate, &mut |ix, iy| hits.push((ix, iy)));
        for &(ix, iy) in &hits {
            for &l in layers {
                self.mark(l, ix, iy, net);
            }
        }
        let mut covered = Vec::new();
        self.raster(s, cover_thr, &mut |ix, iy| covered.push((ix, iy)));
        for (ix, iy) in covered {
            for &l in layers {
                let n = self.node(l, ix, iy);
                if self.owner[n] == net && self.cover[n] < 0 {
                    self.cover[n] = id as i32;
                    self.cells[id].push(n as u32);
                    let bx = &mut self.ibox[id];
                    bx[0] = bx[0].min(ix as i32);
                    bx[1] = bx[1].min(iy as i32);
                    bx[2] = bx[2].max(ix as i32);
                    bx[3] = bx[3].max(iy as i32);
                }
            }
        }
    }

    pub fn grid(&self) -> f64 {
        self.g
    }

    pub fn layer_bits(&self) -> &[u32] {
        &self.p.layers
    }

    pub fn has_layer(&self, bit: u32) -> bool {
        self.layer_index(bit).is_some()
    }
}

/// A segment shape (capsule) with radius r.
pub fn seg_shape(a: [f64; 2], b: [f64; 2], r: f64) -> Shape {
    let mut s = Shape {
        kind: KIND_CAPSULE, mask: 0, net: -1, obj: -1, flags: 0, clr: 0.0, r,
        pts: vec![a, b], rings: Vec::new(), closed: false,
        bbox: [a[0].min(b[0]) - r, a[1].min(b[1]) - r, a[0].max(b[0]) + r, a[1].max(b[1]) + r],
        cx: (a[0] + b[0]) / 2.0, cy: (a[1] + b[1]) / 2.0, hw: 0.0, hh: r, rot: 0.0,
    };
    if a == b {
        s.pts.truncate(1);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(kind: f64, mask: f64, net: f64, obj: f64, flags: f64, geom: &[f64]) -> Shape {
        let mut v = vec![kind, mask, net, obj, flags, 200_000.0];
        v.extend_from_slice(geom);
        decode(&v, 0).0
    }

    fn params(nets: usize) -> RouteParams {
        RouteParams {
            grid: 225_000.0, layers: vec![0, 5], allowed: 1 | 32, clearance: 200_000.0, via_r: 300_000.0,
            via_cost: 8.0, edge_clearance: 300_000.0, net_hw: vec![125_000.0; nets], default_hw: 125_000.0,
            nets: Vec::new(), max_nodes: 2_000_000, order: 0,
        }
    }

    fn board() -> Vec<Vec<[f64; 2]>> {
        vec![vec![[0.0, 0.0], [20_000_000.0, 0.0], [20_000_000.0, 10_000_000.0], [0.0, 10_000_000.0]]]
    }

    #[test]
    fn routes_two_pads() {
        let a = rec(3.0, 1.0, 0.0, 0.0, F_PAD as f64, &[2_000_000.0, 5_000_000.0, 400_000.0, 300_000.0, 0.0, 0.0]);
        let b = rec(3.0, 1.0, 0.0, 1.0, F_PAD as f64, &[18_000_000.0, 5_000_000.0, 400_000.0, 300_000.0, 0.0, 0.0]);
        let mut r = Router::new(vec![a, b], &board(), params(1));
        assert_eq!(r.total, 1);
        while r.step(10) > 0 {}
        assert_eq!(r.routed, 1);
        assert!(r.failed.is_empty());
        assert!(!r.tracks.is_empty());
        // Straight shot: the merged path should be a single run plus stubs.
        assert!(r.tracks.len() <= 3);
    }

    #[test]
    fn routes_around_a_wall_using_a_via() {
        // A wall of other-net copper on top splits the board; bottom is free.
        let wall = rec(2.0, 1.0, 1.0, 2.0, F_TRACK as f64, &[10_000_000.0, -1_000_000.0, 10_000_000.0, 11_000_000.0, 300_000.0]);
        let a = rec(3.0, 1.0, 0.0, 0.0, F_PAD as f64, &[2_000_000.0, 5_000_000.0, 400_000.0, 300_000.0, 0.0, 0.0]);
        let b = rec(3.0, 1.0, 0.0, 1.0, F_PAD as f64, &[18_000_000.0, 5_000_000.0, 400_000.0, 300_000.0, 0.0, 0.0]);
        let mut r = Router::new(vec![wall, a, b], &board(), params(2));
        while r.step(10) > 0 {}
        assert_eq!(r.routed, 1);
        assert!(r.vias.len() >= 2);
        assert!(r.tracks.iter().any(|t| t.layer == 5));
    }

    #[test]
    fn already_connected_pads_need_no_route() {
        let a = rec(1.0, 1.0, 0.0, 0.0, F_PAD as f64, &[2_000_000.0, 5_000_000.0, 400_000.0]);
        let t = rec(2.0, 1.0, 0.0, 2.0, F_TRACK as f64, &[2_000_000.0, 5_000_000.0, 8_000_000.0, 5_000_000.0, 125_000.0]);
        let b = rec(1.0, 1.0, 0.0, 1.0, F_PAD as f64, &[8_000_000.0, 5_000_000.0, 400_000.0]);
        let r = Router::new(vec![a, t, b], &board(), params(1));
        assert_eq!(r.total, 0);
    }
}
