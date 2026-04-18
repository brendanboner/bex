'use client';
import { useEffect, useRef } from 'react';

export function Spirograph({ size = 480 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = size;
    const H = size;
    canvas.width = W;
    canvas.height = H;

    let animFrame: number;
    let t = 0;

    // Parameters tuned to match the reference image (torus-like spirograph)
    const layers = [
      { R: 160, r: 63, d: 82, speed: 0.004, color: [232, 121, 249], alpha: 0.55 },  // pink
      { R: 150, r: 49, d: 95, speed: 0.003, color: [168, 85, 247],  alpha: 0.45 },  // purple
      { R: 145, r: 72, d: 70, speed: 0.005, color: [249, 115, 22],  alpha: 0.35 },  // orange
      { R: 155, r: 55, d: 88, speed: 0.0035,color: [232, 232, 248], alpha: 0.15 },  // white
    ];

    // Pre-render static spirograph paths (like the reference — not animated rotation, just drawn once slowly)
    const totalSteps = 3000;
    let step = 0;

    function draw() {
      if (!ctx) return;

      // Clear with slight trail for smooth look
      ctx.fillStyle = 'rgba(10, 10, 15, 0.08)';
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const batchSize = 12;

      for (let b = 0; b < batchSize && step < totalSteps; b++, step++) {
        const progress = step / totalSteps;
        const angle = progress * Math.PI * 36; // multiple revolutions

        for (const layer of layers) {
          const { R, r, d, color, alpha } = layer;
          const x = cx + (R - r) * Math.cos(angle) + d * Math.cos(((R - r) / r) * angle);
          const y = cy + (R - r) * Math.sin(angle) - d * Math.sin(((R - r) / r) * angle);

          // Vary alpha by progress for fade-in
          const fadeIn = Math.min(1, progress * 4);
          ctx.beginPath();
          ctx.arc(x, y, 0.7, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * fadeIn})`;
          ctx.fill();
        }
      }

      // After drawing all steps, do a slow rotation animation
      if (step >= totalSteps) {
        t += 0.003;
        ctx.fillStyle = 'rgba(10, 10, 15, 0.015)';
        ctx.fillRect(0, 0, W, H);

        const angle = t * Math.PI * 36;
        const dotCount = 8;
        for (let i = 0; i < dotCount; i++) {
          const a = angle + (i / dotCount) * Math.PI * 36;
          for (const layer of layers) {
            const { R, r, d, color, alpha } = layer;
            const x = cx + (R - r) * Math.cos(a) + d * Math.cos(((R - r) / r) * a);
            const y = cy + (R - r) * Math.sin(a) - d * Math.sin(((R - r) / r) * a);
            ctx.beginPath();
            ctx.arc(x, y, 0.8, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * 0.6})`;
            ctx.fill();
          }
        }
      }

      animFrame = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animFrame);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="opacity-90"
    />
  );
}
