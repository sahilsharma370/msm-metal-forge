import { useEffect, useRef } from "react";

type Props = { className?: string; glow?: number; glowColor?: string; interactive?: boolean };

/** Interactive dot grid: dots ease toward the cursor and glow softly nearby. */
export function DotGrid({
  className = "",
  glow = 1,
  glowColor = "193, 98, 46",
  interactive = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const spacing = 26;
    const radius = 170;
    let width = 0;
    let height = 0;
    let raf = 0;
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = e.clientX - rect.left;
      pointer.ty = e.clientY - rect.top;
    };
    const onLeave = () => {
      pointer.tx = -9999;
      pointer.ty = -9999;
    };

    const draw = () => {
      pointer.x += (pointer.tx - pointer.x) * 0.08;
      pointer.y += (pointer.ty - pointer.y) * 0.08;
      ctx.clearRect(0, 0, width, height);

      const fx = width * 0.72;
      const fy = height * 0.18;
      const focal = ctx.createRadialGradient(fx, fy, 0, fx, fy, Math.max(width, height) * 0.75);
      focal.addColorStop(0, `rgba(${glowColor}, ${0.42 * glow})`);
      focal.addColorStop(0.35, `rgba(${glowColor}, ${0.16 * glow})`);
      focal.addColorStop(1, `rgba(${glowColor}, 0)`);
      ctx.fillStyle = focal;
      ctx.fillRect(0, 0, width, height);

      for (let x = spacing / 2; x < width; x += spacing) {
        for (let y = spacing / 2; y < height; y += spacing) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const dist = Math.hypot(dx, dy);
          let ox = 0;
          let oy = 0;
          let intensity = 0;
          if (interactive && dist < radius) {
            const f = 1 - dist / radius;
            intensity = f * f;
            const push = intensity * 9;
            ox = (dx / (dist || 1)) * push;
            oy = (dy / (dist || 1)) * push;
          }
          const size = 1 + intensity * 1.4;
          const alpha = 0.16 + intensity * 0.75;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, size, 0, Math.PI * 2);
          ctx.fillStyle =
            intensity > 0.02 ? `rgba(216, 138, 82, ${alpha})` : `rgba(178, 195, 225, ${alpha})`;
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (interactive) {
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerleave", onLeave);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (interactive) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerleave", onLeave);
      }
    };
  }, [glow, glowColor, interactive]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}