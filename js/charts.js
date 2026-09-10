// charts.js — NERV指揮画面用リアルタイムグラフ
class NervCharts {
    constructor() {
        this.canvases = {
            speed: document.getElementById('chart-speed'),
            motion: document.getElementById('chart-motion'),
            noise: document.getElementById('chart-noise')
        };
        this.hud = {
            speed: document.getElementById('hud-speed'),
            motion: document.getElementById('hud-motion'),
            noise: document.getElementById('hud-noise')
        };
        this.history = [];
        this.windowMs = 40000;
        this.lastPush = 0;
        this.snapshot = this.emptySnapshot();
        this.dirty = true;
        this.running = true;
        this.fitCanvases();
        window.addEventListener('resize', () => this.fitCanvases());
        this.loop();
    }

    emptySnapshot() {
        return {
            t: 0,
            speed: 0,
            rms: 0,
            shake: 0,
            lateralG: 0,
            dbfs: -50,
            quietness: null,
            voice: false,
            calibrated: false
        };
    }

    clear() {
        this.history = [];
        this.snapshot = this.emptySnapshot();
        this.dirty = true;
        this.updateHud();
    }

    ingest(partial) {
        Object.assign(this.snapshot, partial, { t: performance.now() });
        const now = this.snapshot.t;
        if (now - this.lastPush < 120) {
            this.dirty = true;
            this.updateHud();
            return;
        }
        this.lastPush = now;
        this.history.push(Object.assign({}, this.snapshot));
        const cutoff = now - this.windowMs;
        while (this.history.length && this.history[0].t < cutoff) {
            this.history.shift();
        }
        this.dirty = true;
        this.updateHud();
    }

    updateHud() {
        const s = this.snapshot;
        if (this.hud.speed) {
            this.hud.speed.textContent = `${(s.speed || 0).toFixed(0)} km/h`;
        }
        if (this.hud.motion) {
            this.hud.motion.textContent =
                `VIB ${(s.rms || 0).toFixed(2)}  LAT ${Math.abs(s.lateralG || 0).toFixed(2)}G`;
        }
        if (this.hud.noise) {
            const q = s.quietness == null ? '--' : String(s.quietness);
            this.hud.noise.textContent = `${(s.dbfs || 0).toFixed(0)} dB  Q ${q}`;
        }
    }

    fitCanvases() {
        Object.keys(this.canvases).forEach((key) => {
            const canvas = this.canvases[key];
            if (!canvas) {
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(8, Math.floor(rect.width * dpr));
            const h = Math.max(8, Math.floor(rect.height * dpr));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
        });
        this.dirty = true;
    }

    loop() {
        if (!this.running) {
            return;
        }
        if (this.dirty) {
            this.drawAll();
            this.dirty = false;
        }
        requestAnimationFrame(() => this.loop());
    }

    drawAll() {
        this.drawSpeed();
        this.drawMotion();
        this.drawNoise();
    }

    axisX(t, now, width) {
        const x = width * (1 - (now - t) / this.windowMs);
        return Math.max(0, Math.min(width, x));
    }

    yOf(value, min, max, h) {
        const range = (max - min) || 1;
        return h - ((value - min) / range) * h;
    }

    drawFrame(ctx, w, h) {
        ctx.clearRect(0, 0, w, h);
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#0c100c');
        bg.addColorStop(1, '#050605');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(255, 122, 24, 0.12)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            const y = (h * i) / 4;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255, 122, 24, 0.08)';
        for (let i = 1; i < 8; i++) {
            const x = (w * i) / 8;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255, 122, 24, 0.45)';
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    }

    plot(ctx, points, now, w, h, getter, yMin, yMax) {
        if (points.length < 2) {
            return false;
        }
        ctx.beginPath();
        points.forEach((p, i) => {
            const x = this.axisX(p.t, now, w);
            const y = this.yOf(getter(p), yMin, yMax, h);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        return true;
    }

    fillToBaseline(ctx, points, now, w, h, getter, yMin, yMax, fill, baselineValue) {
        if (!this.plot(ctx, points, now, w, h, getter, yMin, yMax)) {
            return;
        }
        const baseY = this.yOf(baselineValue, yMin, yMax, h);
        ctx.lineTo(this.axisX(points[points.length - 1].t, now, w), baseY);
        ctx.lineTo(this.axisX(points[0].t, now, w), baseY);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
    }

    strokeLine(ctx, points, now, w, h, getter, yMin, yMax, color, width) {
        if (!this.plot(ctx, points, now, w, h, getter, yMin, yMax)) {
            return;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    glowLast(ctx, points, now, w, h, getter, yMin, yMax, color) {
        if (!points.length) {
            return;
        }
        const p = points[points.length - 1];
        const x = this.axisX(p.t, now, w);
        const y = this.yOf(getter(p), yMin, yMax, h);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    label(ctx, text, x, y, color) {
        ctx.fillStyle = color;
        ctx.font = '11px Consolas, monospace';
        ctx.fillText(text, x, y);
    }

    drawSpeed() {
        const canvas = this.canvases.speed;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        this.drawFrame(ctx, w, h);
        const now = performance.now();
        const pts = this.history;
        const maxV = Math.max(80, ...pts.map((p) => p.speed || 0));

        this.fillToBaseline(
            ctx, pts, now, w, h,
            (p) => p.speed || 0, 0, maxV,
            'rgba(57, 255, 80, 0.22)', 0
        );
        this.strokeLine(
            ctx, pts, now, w, h,
            (p) => p.speed || 0, 0, maxV,
            '#39ff50', 2.4
        );
        this.glowLast(ctx, pts, now, w, h, (p) => p.speed || 0, 0, maxV, '#39ff50');
        this.label(ctx, `${maxV.toFixed(0)}`, 6, 14, 'rgba(57,255,80,0.7)');
        this.label(ctx, '0', 6, h - 6, 'rgba(57,255,80,0.45)');
    }

    drawMotion() {
        const canvas = this.canvases.motion;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        this.drawFrame(ctx, w, h);
        const now = performance.now();
        const pts = this.history;
        const maxRms = Math.max(1.2, ...pts.map((p) => Math.max(p.rms || 0, p.shake || 0)));
        const maxG = Math.max(0.45, ...pts.map((p) => Math.abs(p.lateralG || 0)));

        // 振動の体感ゾーン（下ほど穏やか）
        const comfortY = this.yOf(0.315, 0, maxRms, h);
        ctx.fillStyle = 'rgba(57, 255, 80, 0.06)';
        ctx.fillRect(0, comfortY, w, h - comfortY);
        ctx.fillStyle = 'rgba(255, 59, 48, 0.08)';
        ctx.fillRect(0, 0, w, this.yOf(0.8, 0, maxRms, h));

        this.fillToBaseline(
            ctx, pts, now, w, h,
            (p) => p.rms || 0, 0, maxRms,
            'rgba(255, 210, 0, 0.28)', 0
        );
        this.strokeLine(
            ctx, pts, now, w, h,
            (p) => p.rms || 0, 0, maxRms,
            '#ffd200', 2.2
        );

        // 横Gは中央ゼロの波形。左右の振れが一目で分かる
        const mid = h / 2;
        ctx.strokeStyle = 'rgba(255, 59, 48, 0.35)';
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(w, mid);
        ctx.stroke();
        ctx.setLineDash([]);

        if (pts.length >= 2) {
            ctx.beginPath();
            pts.forEach((p, i) => {
                const x = this.axisX(p.t, now, w);
                const y = mid - ((p.lateralG || 0) / maxG) * (h * 0.42);
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.strokeStyle = '#ff3b30';
            ctx.lineWidth = 2.4;
            ctx.stroke();

            ctx.lineTo(this.axisX(pts[pts.length - 1].t, now, w), mid);
            ctx.lineTo(this.axisX(pts[0].t, now, w), mid);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255, 59, 48, 0.16)';
            ctx.fill();
        }

        this.glowLast(ctx, pts, now, w, h, (p) => p.rms || 0, 0, maxRms, '#ffd200');
        this.label(ctx, 'VIB', 6, 14, 'rgba(255,210,0,0.8)');
        this.label(ctx, 'LAT G', w - 48, 14, 'rgba(255,59,48,0.85)');
    }

    drawNoise() {
        const canvas = this.canvases.noise;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        this.drawFrame(ctx, w, h);
        const now = performance.now();
        const pts = this.history;
        const calibrated = pts.some((p) => p.calibrated);
        const yMin = calibrated ? -40 : -60;
        const yMax = calibrated ? 8 : 0;

        // 静粛性：緑の面積が大きいほど静か
        this.fillToBaseline(
            ctx, pts, now, w, h,
            (p) => p.quietness == null ? 0 : p.quietness,
            0, 100,
            'rgba(57, 255, 80, 0.20)', 0
        );
        this.strokeLine(
            ctx, pts, now, w, h,
            (p) => p.quietness == null ? 0 : p.quietness,
            0, 100,
            'rgba(57, 255, 80, 0.85)', 1.6
        );

        this.fillToBaseline(
            ctx, pts, now, w, h,
            (p) => p.dbfs == null ? yMin : p.dbfs,
            yMin, yMax,
            'rgba(0, 229, 255, 0.14)', yMin
        );
        this.strokeLine(
            ctx, pts, now, w, h,
            (p) => p.dbfs == null ? yMin : p.dbfs,
            yMin, yMax,
            '#00e5ff', 2.4
        );

        pts.forEach((p) => {
            if (!p.voice) {
                return;
            }
            const x = this.axisX(p.t, now, w);
            ctx.fillStyle = 'rgba(255, 59, 48, 0.22)';
            ctx.fillRect(x - 2, 0, 4, h);
        });

        this.glowLast(
            ctx, pts, now, w, h,
            (p) => p.dbfs == null ? yMin : p.dbfs,
            yMin, yMax,
            '#00e5ff'
        );
        this.label(ctx, 'Q', 6, 14, 'rgba(57,255,80,0.8)');
        this.label(ctx, 'SPL', w - 32, 14, 'rgba(0,229,255,0.85)');
    }
}

window.NervCharts = NervCharts;
