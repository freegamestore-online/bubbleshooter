import { useEffect, useRef, useState, useCallback } from "react";
import { GameShell, GameTopbar, GameAuth, GameButton } from "@freegamestore/games";
import { useHighScore } from "./hooks/useHighScore";

const COLS = 10;
const ROWS = 14;
const COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#a855f7"];
const INITIAL_ROWS = 6;
const SHOOTER_SAFETY = 1.2; // bubble radii above bottom

type Grid = (number | null)[][];

interface Flyer {
  x: number; y: number;
  vx: number; vy: number;
  color: number;
}

function freshGrid(): Grid {
  const g: Grid = Array.from({ length: ROWS }, () => Array<number | null>(COLS).fill(null));
  for (let r = 0; r < INITIAL_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // Odd rows have one fewer column (offset)
      if (r % 2 === 1 && c === COLS - 1) continue;
      g[r]![c] = Math.floor(Math.random() * COLORS.length);
    }
  }
  return g;
}

// Convert grid (row, col) to pixel center given bubble radius
function cellCenter(r: number, c: number, R: number): { x: number; y: number } {
  const x = R + c * 2 * R + (r % 2 === 1 ? R : 0);
  const y = R + r * R * Math.sqrt(3);
  return { x, y };
}

function nearestCell(x: number, y: number, R: number): { r: number; c: number } {
  const r = Math.round((y - R) / (R * Math.sqrt(3)));
  const c = Math.round((x - R - (r % 2 === 1 ? R : 0)) / (2 * R));
  return { r, c };
}

function neighbors(r: number, c: number): [number, number][] {
  const odd = r % 2 === 1;
  const offs: [number, number][] = odd
    ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
    : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
  return offs.map(([dr, dc]) => [r + dr, c + dc]);
}

function inBounds(r: number, c: number): boolean {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
  if (r % 2 === 1 && c === COLS - 1) return false;
  return true;
}

function findCluster(g: Grid, sr: number, sc: number, sameColor: boolean): [number, number][] {
  const start = g[sr]?.[sc];
  if (start == null) return [];
  const seen = new Set<string>();
  const out: [number, number][] = [];
  const stack: [number, number][] = [[sr, sc]];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const v = g[r]?.[c];
    if (v == null) continue;
    if (sameColor && v !== start) continue;
    out.push([r, c]);
    for (const [nr, nc] of neighbors(r, c)) if (inBounds(nr, nc)) stack.push([nr, nc]);
  }
  return out;
}

function findFloaters(g: Grid): [number, number][] {
  const anchored = new Set<string>();
  const stack: [number, number][] = [];
  for (let c = 0; c < COLS; c++) if (g[0]?.[c] != null) stack.push([0, c]);
  while (stack.length) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (anchored.has(key)) continue;
    anchored.add(key);
    for (const [nr, nc] of neighbors(r, c)) {
      if (inBounds(nr, nc) && g[nr]?.[nc] != null) stack.push([nr, nc]);
    }
  }
  const out: [number, number][] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (g[r]?.[c] != null && !anchored.has(`${r},${c}`)) out.push([r, c]);
  }
  return out;
}

function availableColors(g: Grid): number[] {
  const set = new Set<number>();
  for (const row of g) for (const v of row) if (v != null) set.add(v);
  return set.size > 0 ? Array.from(set) : [0, 1, 2, 3, 4];
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<Grid>(freshGrid());
  const flyerRef = useRef<Flyer | null>(null);
  const nextColorRef = useRef<number>(Math.floor(Math.random() * COLORS.length));
  const aimRef = useRef<{ x: number; y: number }>({ x: 0, y: -1 });
  const sizeRef = useRef({ w: 0, h: 0, R: 16 });
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [_, force] = useState(0);
  const [bestScore, updateHighScore] = useHighScore("bubbleshooter-best");
  const scoreRef = useRef(0);
  scoreRef.current = score;

  const reset = useCallback(() => {
    gridRef.current = freshGrid();
    flyerRef.current = null;
    nextColorRef.current = Math.floor(Math.random() * COLORS.length);
    setScore(0);
    setGameOver(false);
    force((x) => x + 1);
  }, []);

  // Resize canvas and compute R to fit
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const R = Math.floor(Math.min(w / (COLS * 2), h / (ROWS * Math.sqrt(3) + 4)));
      const cssW = R * 2 * COLS;
      const cssH = R * 2 + R * (ROWS - 1) * Math.sqrt(3) + R * 4; // playfield + shooter margin
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w: cssW, h: cssH, R };
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, []);

  // Main animation loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - last);
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function shooterY(): number {
    const { h, R } = sizeRef.current;
    return h - R * SHOOTER_SAFETY;
  }

  function step(dt: number) {
    const f = flyerRef.current;
    if (!f) return;
    const { w, R } = sizeRef.current;
    const speed = dt; // normalize
    f.x += f.vx * speed;
    f.y += f.vy * speed;
    // Wall bounce
    if (f.x < R) { f.x = R; f.vx = Math.abs(f.vx); }
    if (f.x > w - R) { f.x = w - R; f.vx = -Math.abs(f.vx); }
    // Roof
    if (f.y < R) {
      f.y = R;
      snapFlyer(f);
      return;
    }
    // Collision with grid bubbles
    const g = gridRef.current;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (g[r]?.[c] == null) continue;
        const { x, y } = cellCenter(r, c, R);
        const dx = f.x - x, dy = f.y - y;
        if (dx * dx + dy * dy < (R * 2 - 1) ** 2) {
          snapFlyer(f);
          return;
        }
      }
    }
  }

  function snapFlyer(f: Flyer) {
    const { R } = sizeRef.current;
    let { r, c } = nearestCell(f.x, f.y, R);
    // Find closest valid empty cell
    let best: [number, number] | null = null;
    let bestDist = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (!inBounds(rr, cc)) continue;
        if (gridRef.current[rr]?.[cc] != null) continue;
        const { x, y } = cellCenter(rr, cc, R);
        const d = (f.x - x) ** 2 + (f.y - y) ** 2;
        if (d < bestDist) { bestDist = d; best = [rr, cc]; }
      }
    }
    if (!best) {
      flyerRef.current = null;
      checkGameOver();
      return;
    }
    [r, c] = best;
    gridRef.current[r]![c] = f.color;
    flyerRef.current = null;

    // Match clusters
    const cluster = findCluster(gridRef.current, r, c, true);
    if (cluster.length >= 3) {
      for (const [rr, cc] of cluster) gridRef.current[rr]![cc] = null;
      const floaters = findFloaters(gridRef.current);
      for (const [rr, cc] of floaters) gridRef.current[rr]![cc] = null;
      const gained = cluster.length * 10 + floaters.length * 20;
      setScore((s) => {
        const ns = s + gained;
        updateHighScore(ns);
        return ns;
      });
    }
    checkGameOver();
    // Pick next color from what's still on the board
    const cols = availableColors(gridRef.current);
    nextColorRef.current = cols[Math.floor(Math.random() * cols.length)]!;
  }

  function checkGameOver() {
    const { R } = sizeRef.current;
    const limit = shooterY() - R * 2;
    const g = gridRef.current;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (g[r]?.[c] == null) continue;
        const { y } = cellCenter(r, c, R);
        if (y > limit) {
          setGameOver(true);
          return;
        }
      }
    }
    // Win condition — all cleared
    let any = false;
    for (const row of g) for (const v of row) if (v != null) { any = true; break; }
    if (!any) {
      // Refill from top for endless play
      for (let r = 0; r < INITIAL_ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (r % 2 === 1 && c === COLS - 1) continue;
          g[r]![c] = Math.floor(Math.random() * COLORS.length);
        }
      }
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, R } = sizeRef.current;
    // Background
    ctx.fillStyle = "rgba(0,0,0,0.02)";
    ctx.fillRect(0, 0, w, h);

    // Grid bubbles
    const g = gridRef.current;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = g[r]?.[c];
        if (v == null) continue;
        const { x, y } = cellCenter(r, c, R);
        drawBubble(ctx, x, y, R - 1, COLORS[v]!);
      }
    }

    // Danger line
    ctx.strokeStyle = "rgba(220,38,38,0.4)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, shooterY() - R * 2);
    ctx.lineTo(w, shooterY() - R * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Shooter
    const sx = w / 2;
    const sy = shooterY();
    drawBubble(ctx, sx, sy, R - 1, COLORS[nextColorRef.current]!);

    // Aim line
    if (!flyerRef.current && !gameOver) {
      const dx = aimRef.current.x - sx;
      const dy = aimRef.current.y - sy;
      const len = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (dx / len) * R * 4, sy + (dy / len) * R * 4);
      ctx.stroke();
    }

    // Flyer
    const f = flyerRef.current;
    if (f) drawBubble(ctx, f.x, f.y, R - 1, COLORS[f.color]!);
  }

  function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.5)");
    grad.addColorStop(0.4, color);
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function pointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (gameOver) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    aimRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function pointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (gameOver || flyerRef.current) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const ax = e.clientX - rect.left;
    const ay = e.clientY - rect.top;
    aimRef.current = { x: ax, y: ay };
    const { w, R } = sizeRef.current;
    const sx = w / 2;
    const sy = shooterY();
    const dx = ax - sx;
    let dy = ay - sy;
    if (dy > -R * 0.5) dy = -R * 0.5; // never shoot down
    const len = Math.hypot(dx, dy) || 1;
    const speed = 0.7; // px/ms
    flyerRef.current = {
      x: sx, y: sy,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      color: nextColorRef.current,
    };
  }

  return (
    <GameShell
      topbar={
        <GameTopbar
          title="Bubble Shooter"
          stats={[
            { label: "Score", value: score, accent: true },
            { label: "Best", value: bestScore },
          ]}
          rules={
            <div>
              <h3 style={{ marginBottom: "0.5rem", fontWeight: 700 }}>Bubble Shooter</h3>
              <p>Match 3 or more bubbles of the same color to pop them.</p>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Controls</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>Drag to aim, tap or click to shoot</li>
                <li>Bubbles bounce off side walls</li>
              </ul>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Rules</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>3+ same-color cluster pops</li>
                <li>Disconnected bubbles drop and score double</li>
                <li>If a bubble crosses the dashed line, game over</li>
                <li>Clear the board to refill from the top</li>
              </ul>
            </div>
          }
          actions={<GameAuth />}
        />
      }
    >
      <div
        style={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "0.5rem",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "relative", flex: 1, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
          <canvas
            ref={canvasRef}
            onPointerMove={pointerMove}
            onPointerDown={pointerDown}
            style={{
              touchAction: "none",
              borderRadius: "0.4rem",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          />
          {gameOver && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: "1rem",
                background: "rgba(0,0,0,0.55)",
                borderRadius: "0.4rem",
              }}
            >
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "var(--paper)" }}>
                Game Over
              </div>
              <div style={{ color: "var(--paper)" }}>Score: {score}</div>
              <GameButton size="md" variant="primary" onClick={reset}>Play Again</GameButton>
            </div>
          )}
        </div>
        <a
          href="https://freegamestore.online"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--muted)", fontSize: "0.7rem", textDecoration: "none", marginTop: "0.4rem" }}
        >
          Part of FreeGameStore — free forever
        </a>
      </div>
    </GameShell>
  );
}
