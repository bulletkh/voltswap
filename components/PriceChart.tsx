"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SUI_TYPE, USDC_TYPE, USDT_TYPE } from "@/lib/tokens";

type Pt = { t: number; p: number };
const RANGES = {
  "1D": { span: 96, period: "15m" },
  "1W": { span: 84, period: "2h" },
  "1M": { span: 30, period: "1d" },
} as const;
type Range = keyof typeof RANGES;

const PAD = 14;
const STABLE = new Set([USDC_TYPE, USDT_TYPE]);

function fmt(v: number) {
  if (v >= 1000) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return "$" + v.toFixed(3);
  if (v >= 0.01) return "$" + v.toFixed(4);
  return "$" + v.toPrecision(3);
}

// Smooth monotone-ish curve through the points.
function curve(xy: [number, number][]) {
  if (xy.length < 2) return "";
  let d = `M${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) {
    const [x0, y0] = xy[i - 1];
    const [x1, y1] = xy[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

// Drop single-point glitches: a point far from both neighbours (which are close to each other) is replaced by their mean.
function despike(a: Pt[]): Pt[] {
  return a.map((pt, i) => {
    if (i === 0 || i === a.length - 1) return pt;
    const l = a[i - 1].p;
    const r = a[i + 1].p;
    const m = (l + r) / 2;
    if (Math.abs(l - r) / m < 0.03 && Math.abs(pt.p - m) / m > 0.05) return { t: pt.t, p: m };
    return pt;
  });
}

function useTween(target: number | null, reset: string) {
  const [v, setV] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  const seen = useRef(reset);
  useEffect(() => {
    if (target === null) return;
    if (seen.current !== reset) {
      seen.current = reset;
      from.current = null;
    }
    const start = from.current ?? target;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = start + (target - start) * e;
      from.current = cur;
      setV(cur);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reset]);
  return v;
}

export function PriceChart() {
  const [asset, setAsset] = useState({ symbol: "SUI", type: SUI_TYPE });
  const [range, setRange] = useState<Range>("1D");
  const [hist, setHist] = useState<Pt[] | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 280 });
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const fit = () => {
      const w = Math.max(280, Math.round(el.clientWidth));
      setSize({ w, h: Math.round(Math.min(250, Math.max(180, w * 0.24))) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { w: W, h: H } = size;
  const id = `sui:${asset.type}`;

  // follow the token chosen in the swap card or on the tape
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ from: string; fromType: string; to: string; toType: string }>).detail;
      const pickTo = !STABLE.has(d.toType);
      const a = pickTo ? { symbol: d.to, type: d.toType } : !STABLE.has(d.fromType) ? { symbol: d.from, type: d.fromType } : null;
      if (a) setAsset((cur) => (cur.type === a.type ? cur : a));
    };
    window.addEventListener("vs:pair", on);
    return () => window.removeEventListener("vs:pair", on);
  }, []);

  useEffect(() => {
    let alive = true;
    setHist(null);
    setFailed(false);
    setHover(null);
    const enc = encodeURIComponent(id);
    const { span, period } = RANGES[range];
    const end = Math.floor(Date.now() / 1000);
    const get = (q: string) =>
      fetch(`https://coins.llama.fi/chart/${enc}?${q}`)
        .then((r) => r.json())
        .then((j) => (j?.coins?.[id]?.prices as { timestamp: number; price: number }[] | undefined) ?? []);
    get(`end=${end}&span=${span}&period=${period}`)
      .then((a) => (a.length > 2 ? a : get(`span=${span}&period=${period}`)))
      .then((a) => {
        if (!alive) return;
        if (a.length > 2) setHist(despike(a.map((x) => ({ t: x.timestamp, p: x.price }))));
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id, range]);

  // live price, polled
  useEffect(() => {
    let alive = true;
    setLive(null);
    const enc = encodeURIComponent(id);
    const run = () =>
      fetch(`https://coins.llama.fi/prices/current/${enc}`)
        .then((r) => r.json())
        .then((j) => {
          const p = j?.coins?.[id]?.price;
          if (alive && typeof p === "number") setLive(p);
        })
        .catch(() => {});
    void run();
    const t = setInterval(() => !document.hidden && run(), 8_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  const pts = useMemo<Pt[]>(() => {
    if (!hist) return [];
    if (live === null) return hist;
    const now = Math.floor(Date.now() / 1000);
    const last = hist[hist.length - 1];
    return now - last.t > 60 * 20 ? [...hist, { t: now, p: live }] : [...hist.slice(0, -1), { t: last.t, p: live }];
  }, [hist, live]);

  const geo = useMemo(() => {
    if (pts.length < 3) return null;
    const lo = Math.min(...pts.map((p) => p.p));
    const hi = Math.max(...pts.map((p) => p.p));
    const span = hi - lo || hi * 0.01 || 1;
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const xy = pts.map((p) => [PAD + ((p.t - t0) / (t1 - t0 || 1)) * (W - PAD * 2), PAD + 8 + (1 - (p.p - lo) / span) * (H - PAD * 2 - 24)] as [number, number]);
    const line = curve(xy);
    const [lx, ly] = xy[xy.length - 1];
    return { xy, line, area: `${line} L${lx.toFixed(1)} ${H} L${xy[0][0].toFixed(1)} ${H} Z`, lx, ly, lo, hi };
  }, [pts, W, H]);

  const first = pts[0]?.p;
  const lastP = pts.length ? pts[pts.length - 1].p : null;
  const shown = hover !== null && pts[hover] ? pts[hover].p : lastP;
  const tween = useTween(hover === null ? lastP : null, id);
  const ready = hist !== null && live !== null;
  const headPrice = !ready ? null : hover !== null ? shown : tween ?? shown;
  const chg = first && lastP ? ((lastP - first) / first) * 100 : null;
  const up = (chg ?? 0) >= 0;

  function move(e: React.PointerEvent<SVGSVGElement>) {
    if (!geo || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 0; i < geo.xy.length; i++) if (Math.abs(geo.xy[i][0] - x) < Math.abs(geo.xy[best][0] - x)) best = i;
    setHover(best);
  }
  const hp = hover !== null && geo ? geo.xy[hover] : null;
  const when = hover !== null && pts[hover] ? new Date(pts[hover].t * 1000).toLocaleString("en-US", range === "1M" ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Live";

  return (
    <section className="pc" aria-label={`${asset.symbol} price chart`}>
      <div className="pc-head">
        <div>
          <span className="pc-sym">{asset.symbol} / USD</span>
          <div className="pc-price" aria-live="off">{headPrice !== null ? fmt(headPrice) : "—"}</div>
          <span className="pc-when">{hover !== null ? when : <><i className="pc-dot" />Live</>}</span>
        </div>
        <div className="pc-side">
          <div className="pc-ranges" role="group" aria-label="Chart range">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <button key={r} type="button" className={r === range ? "on" : ""} aria-pressed={r === range} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
          {chg !== null && (
            <span className={"pc-chg " + (up ? "up" : "down")}>
              {up ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      <div className="pc-plot" ref={plot}>
        {geo ? (
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${asset.symbol} price over ${range}`} onPointerMove={move} onPointerLeave={() => setHover(null)}>
            <defs>
              <linearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffd60a" stopOpacity="0.32" />
                <stop offset="1" stopColor="#ffd60a" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="pc-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#6f8dff" />
                <stop offset="0.55" stopColor="#ffd60a" />
                <stop offset="1" stopColor="#fff1a0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((k) => (
              <line key={k} x1="0" x2={W} y1={H * k} y2={H * k} className="pc-grid" />
            ))}
            <path key={"a" + id + range} d={geo.area} className="pc-area" fill="url(#pc-fill)" />
            <path key={"l" + id + range} d={geo.line} className="pc-line" pathLength={1} />
            {hp && (
              <>
                <line x1={hp[0]} x2={hp[0]} y1="0" y2={H} className="pc-cross" />
                <circle cx={hp[0]} cy={hp[1]} r="5" className="pc-hdot" />
              </>
            )}
            {!hp && (
              <>
                <circle cx={geo.lx} cy={geo.ly} r="6" className="pc-ring" />
                <circle cx={geo.lx} cy={geo.ly} r="4.5" className="pc-end" />
              </>
            )}
          </svg>
        ) : (
          <div className="pc-empty">{failed ? "Chart unavailable for this token right now." : <span className="pc-skel" />}</div>
        )}
      </div>
    </section>
  );
}
