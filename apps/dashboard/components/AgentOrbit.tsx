'use client';

import { useEffect, useRef, useCallback } from 'react';
import { adminApi } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentLive = {
  id: string;
  name: string;
  description?: string;
  active: boolean;
};

type OrbitalAgent = AgentLive & {
  orbitRadius: number;  // semi-major axis (px)
  orbitSpeed: number;   // radians / ms  (signed — negative = CCW)
  angle: number;        // current true anomaly (radians)
  pulsePhase: number;   // 0–1 breathing cycle when active
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function assignOrbits(agents: AgentLive[], maxRadius: number): OrbitalAgent[] {
  if (!agents.length) return [];

  const ringCount = Math.min(6, Math.max(2, Math.ceil(agents.length / 3)));
  const minR = maxRadius * 0.22;
  const maxR = maxRadius * 0.88;
  const step = ringCount > 1 ? (maxR - minR) / (ringCount - 1) : 0;

  return agents.map((a, i) => {
    const ring = i % ringCount;
    const baseR = minR + ring * step;
    const jitter = ((i * 37) % 17 - 8) / 200;
    const orbitRadius = baseR * (1 + jitter);
    const direction = ring % 2 === 0 ? 1 : -1;
    const speedBase = 0.00012 + ring * 0.000018;
    const speedJitter = ((i * 13) % 7) * 0.000008;
    const agentsInRing = agents.filter((_, j) => j % ringCount === ring).length;
    const posInRing = Math.floor(i / ringCount);
    const startAngle = (posInRing / Math.max(agentsInRing, 1)) * Math.PI * 2;

    return {
      ...a,
      orbitRadius,
      orbitSpeed: (speedBase + speedJitter) * direction,
      angle: startAngle,
      pulsePhase: 0,
    };
  });
}

// ── Pure-canvas renderer ──────────────────────────────────────────────────────

// 3D perspective constants
const TILT = 0.38;          // Y compression for orbital ellipse
const BASE_R = 18;          // base node radius (px, logical)
const DEPTH_SCALE = 0.40;   // how much radius changes front↔back

/**
 * Map an agent's orbital angle to a depth value in [-1, +1].
 * sin(angle) = +1  → front (closest, largest)
 * sin(angle) = -1  → back  (farthest, smallest)
 */
function depthOf(angle: number): number {
  return Math.sin(angle); // range [-1, 1]
}

function nodeRadius(depth: number): number {
  return BASE_R * (1 + DEPTH_SCALE * depth);
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  agents: OrbitalAgent[],
  dpr: number,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);

  // ── Orbit ring tracks ──────────────────────────────────────────────────────
  const radii = [...new Set(agents.map((a) => Math.round(a.orbitRadius)))];

  for (const r of radii) {
    ctx.save();
    ctx.translate(cx * dpr, cy * dpr);
    ctx.scale(dpr, dpr * TILT);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148,163,184,0.09)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  // ── Centre glow ────────────────────────────────────────────────────────────
  const grad = ctx.createRadialGradient(cx * dpr, cy * dpr, 0, cx * dpr, cy * dpr, 28 * dpr);
  grad.addColorStop(0,   'rgba(139,92,246,0.55)');
  grad.addColorStop(0.5, 'rgba(99,102,241,0.22)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(cx * dpr, cy * dpr, 28 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx * dpr, cy * dpr, 4 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(192,132,252,0.95)';
  ctx.fill();

  // ── Agent nodes — sort by depth so front nodes render on top ──────────────
  const sorted = [...agents].sort((a, b) => depthOf(a.angle) - depthOf(b.angle));

  for (const agent of sorted) {
    const depth = depthOf(agent.angle);
    const nx = (cx + agent.orbitRadius * Math.cos(agent.angle)) * dpr;
    const ny = (cy + agent.orbitRadius * Math.sin(agent.angle) * TILT) * dpr;
    const r  = nodeRadius(depth) * dpr;

    // Compute colours
    const isActive = agent.active;
    const pulse = isActive ? Math.sin(agent.pulsePhase * Math.PI * 2) : 0; // -1..1

    // Back nodes slightly fade to reinforce depth
    const depthAlpha = 0.55 + 0.45 * ((depth + 1) / 2); // 0.55 (back) → 1.0 (front)

    ctx.save();
    ctx.globalAlpha = depthAlpha;

    // Outer glow when active
    if (isActive) {
      const glowR = r * (1.55 + 0.2 * pulse);
      const glow = ctx.createRadialGradient(nx, ny, r * 0.8, nx, ny, glowR);
      glow.addColorStop(0, `rgba(167,139,250,${0.45 + 0.2 * pulse})`);
      glow.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.beginPath();
      ctx.arc(nx, ny, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
    }

    // Main circle fill
    if (isActive) {
      const fill = ctx.createRadialGradient(nx - r * 0.25, ny - r * 0.25, 0, nx, ny, r);
      fill.addColorStop(0,   'rgba(196,181,253,0.95)');
      fill.addColorStop(0.5, 'rgba(124,58,237,0.95)');
      fill.addColorStop(1,   'rgba(76,29,149,0.95)');
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30,41,59,0.88)';
      ctx.fill();
    }

    // Border
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, Math.PI * 2);
    ctx.strokeStyle = isActive
      ? `rgba(167,139,250,${0.75 + 0.25 * pulse})`
      : 'rgba(100,116,139,0.35)';
    ctx.lineWidth = (isActive ? 1.5 : 0.8) * dpr;
    ctx.stroke();

    // Initials text
    const fontSize = Math.round(r * 0.54);
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isActive
      ? `rgba(255,255,255,${0.9 + 0.1 * pulse})`
      : 'rgba(148,163,184,0.75)';
    ctx.fillText(initials(agent.name), nx, ny + dpr * 0.5); // tiny nudge for optical centering

    ctx.restore();
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentOrbit({ size = 420 }: { size?: number }) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const agentsRef   = useRef<OrbitalAgent[]>([]);
  const rafRef      = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Fetch agents every 8s
  const fetchAgents = useCallback(async () => {
    try {
      const data = await adminApi.get<AgentLive[]>('/admin/agents/live');
      if (!Array.isArray(data)) return;
      const cx = size / 2;
      const maxR = cx - BASE_R - 10;
      const prevMap = new Map(agentsRef.current.map((a) => [a.id, a]));
      const fresh = assignOrbits(data, maxR);
      agentsRef.current = fresh.map((a) => {
        const prev = prevMap.get(a.id);
        return prev
          ? { ...a, angle: prev.angle, orbitSpeed: prev.orbitSpeed, orbitRadius: prev.orbitRadius, pulsePhase: prev.pulsePhase }
          : a;
      });
    } catch { /* auth not ready yet — ignore */ }
  }, [size]);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 8_000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  // Animation loop — pure canvas, no React state updates
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const safeCtx: CanvasRenderingContext2D = ctx;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = `${size}px`;
    canvas.style.height = `${size}px`;
    // Do NOT ctx.scale here — we handle DPR manually in drawFrame

    const cx = size / 2;
    const cy = size / 2;

    function loop(ts: number) {
      const dt = Math.min(ts - (lastTimeRef.current || ts), 40); // ms, cap at ~25fps lag
      lastTimeRef.current = ts;

      // Mutate angles in place — no state, no re-render jolt
      for (const a of agentsRef.current) {
        a.angle += a.orbitSpeed * dt;
        if (a.active) {
          a.pulsePhase = (a.pulsePhase + dt / 1600) % 1;
        } else {
          a.pulsePhase = 0;
        }
      }

      drawFrame(safeCtx, cx, cy, agentsRef.current, dpr);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: size,
        height: size,
        background: 'transparent',
      }}
    />
  );
}
