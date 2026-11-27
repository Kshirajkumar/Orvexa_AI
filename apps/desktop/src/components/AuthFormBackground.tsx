import React, { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hueIndex: number;
  phase: number;
}

interface Pulse {
  fromIdx: number;
  toIdx: number;
  progress: number;
  speed: number;
  hueIndex: number;
}

/**
 * Multi-layered animated backdrop rendered behind the login/signup form card.
 * Combines drifting aurora orbs, an architectural FinTech grid, rotating orbital
 * rings, and an interactive 60fps constellation/data-pulse canvas.
 */
export const AuthFormBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const parentPanel = root.parentElement;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    const pointer = { x: -9999, y: -9999, active: false };

    const getPalette = () => {
      const styles = getComputedStyle(document.documentElement);
      const blue = styles.getPropertyValue('--blue').trim() || (isDark ? '#4C8DFF' : '#2563EB');
      const cyan = styles.getPropertyValue('--cyan').trim() || (isDark ? '#3DD6F5' : '#0891B2');
      const violet = styles.getPropertyValue('--violet').trim() || (isDark ? '#8B7CFF' : '#6D5BEA');
      return [blue, cyan, violet];
    };

    let palette = getPalette();

    const hexToRgba = (hex: string, alpha: number): string => {
      const clean = hex.replace('#', '').trim();
      if (clean.length === 3) {
        const r = parseInt(clean[0] + clean[0], 16);
        const g = parseInt(clean[1] + clean[1], 16);
        const b = parseInt(clean[2] + clean[2], 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      if (clean.length === 6) {
        const r = parseInt(clean.slice(0, 2), 16);
        const g = parseInt(clean.slice(2, 4), 16);
        const b = parseInt(clean.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      return `rgba(76, 141, 255, ${alpha})`;
    };

    const particles: Particle[] = [];
    const pulses: Pulse[] = [];
    const PARTICLE_COUNT = 42;
    const MAX_LINK_DIST = 145;

    const initParticles = () => {
      particles.length = 0;
      pulses.length = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.36,
          vy: (Math.random() - 0.5) * 0.36,
          radius: 1.4 + Math.random() * 1.8,
          hueIndex: i % 3,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const resize = () => {
      const rect = root.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (particles.length === 0) {
        initParticles();
      }
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);

    const themeObserver = new MutationObserver(() => {
      isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      palette = getPalette();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const handlePointerMove = (e: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
    };

    const handlePointerLeave = () => {
      pointer.active = false;
    };

    if (parentPanel) {
      parentPanel.addEventListener('pointermove', handlePointerMove, { passive: true });
      parentPanel.addEventListener('pointerleave', handlePointerLeave);
    }

    let time = 0;

    const drawFrame = () => {
      time += 0.016;
      ctx.clearRect(0, 0, width, height);

      const lineAlphaBase = isDark ? 0.19 : 0.14;
      const nodeAlphaBase = isDark ? 0.65 : 0.5;

      // Update particle positions
      if (!reducedMotion) {
        for (const p of particles) {
          p.x += p.vx;
          p.y += p.vy;

          if (p.x < -20) p.x = width + 20;
          else if (p.x > width + 20) p.x = -20;

          if (p.y < -20) p.y = height + 20;
          else if (p.y > height + 20) p.y = -20;

          // Subtle gentle attraction toward cursor
          if (pointer.active) {
            const dx = pointer.x - p.x;
            const dy = pointer.y - p.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > 400 && distSq < 32000) {
              const dist = Math.sqrt(distSq);
              p.x += (dx / dist) * 0.18;
              p.y += (dy / dist) * 0.18;
            }
          }
        }
      }

      // Draw constellation edges
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);

          if (dist < MAX_LINK_DIST) {
            const strength = 1 - dist / MAX_LINK_DIST;
            ctx.strokeStyle = hexToRgba(palette[a.hueIndex], strength * lineAlphaBase);
            ctx.lineWidth = 0.8 + strength * 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();

            // Occasionally spawn a data-flow pulse along a strong connection
            if (!reducedMotion && pulses.length < 7 && Math.random() < 0.0022) {
              pulses.push({
                fromIdx: i,
                toIdx: j,
                progress: 0,
                speed: 0.012 + Math.random() * 0.014,
                hueIndex: (a.hueIndex + 1) % 3,
              });
            }
          }
        }

        // Connect nearby nodes softly to pointer
        if (pointer.active) {
          const pdx = pointer.x - a.x;
          const pdy = pointer.y - a.y;
          const pDist = Math.hypot(pdx, pdy);
          if (pDist < 170) {
            const pStrength = 1 - pDist / 170;
            ctx.strokeStyle = hexToRgba(palette[1], pStrength * (isDark ? 0.32 : 0.24));
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }

      // Draw traveling data pulses
      for (let k = pulses.length - 1; k >= 0; k--) {
        const pulse = pulses[k];
        pulse.progress += pulse.speed;
        if (pulse.progress >= 1) {
          pulses.splice(k, 1);
          continue;
        }
        const from = particles[pulse.fromIdx];
        const to = particles[pulse.toIdx];
        if (!from || !to) {
          pulses.splice(k, 1);
          continue;
        }
        const px = from.x + (to.x - from.x) * pulse.progress;
        const py = from.y + (to.y - from.y) * pulse.progress;
        const fade = Math.sin(pulse.progress * Math.PI);
        const color = palette[pulse.hueIndex];

        const glow = ctx.createRadialGradient(px, py, 0, px, py, 9);
        glow.addColorStop(0, hexToRgba(color, 0.85 * fade));
        glow.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hexToRgba('#ffffff', 0.9 * fade);
        ctx.beginPath();
        ctx.arc(px, py, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw glowing nodes
      for (const p of particles) {
        const twinkle = 0.65 + 0.35 * Math.sin(time * 1.8 + p.phase);
        const color = palette[p.hueIndex];

        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 4.5);
        halo.addColorStop(0, hexToRgba(color, (isDark ? 0.28 : 0.18) * twinkle));
        halo.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hexToRgba(color, nodeAlphaBase * twinkle);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    drawFrame();

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      if (parentPanel) {
        parentPanel.removeEventListener('pointermove', handlePointerMove);
        parentPanel.removeEventListener('pointerleave', handlePointerLeave);
      }
    };
  }, []);

  return (
    <div ref={rootRef} className="auth-form-bg" aria-hidden="true">
      {/* Drifting Aurora Orbs */}
      <div className="auth-form-orb auth-form-orb-1" />
      <div className="auth-form-orb auth-form-orb-2" />
      <div className="auth-form-orb auth-form-orb-3" />

      {/* Subtle Architectural FinTech Grid */}
      <div className="auth-form-grid" />

      {/* Rotating Precision Orbital Rings */}
      <div className="auth-form-rings">
        <div className="auth-form-ring auth-form-ring-outer" />
        <div className="auth-form-ring auth-form-ring-inner" />
      </div>

      {/* Interactive Constellation & Data-Pulse Canvas */}
      <canvas ref={canvasRef} className="auth-form-canvas" />
    </div>
  );
};
