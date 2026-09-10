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
            comfort: document.getElementById('hud-comfort'),
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
            combinedRms: 0,
            freq: 0,
            comfort: '',
            comfortClass: '',
            dbfs: -50,
            quietness: null,
            voice: false,
            calibrated: false,
            engineDb: -50,
            roadDb: -50,
            windDb: -50
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
            const hz = s.freq ? `${s.freq.toFixed(1)}Hz` : '--Hz';
            this.hud.motion.textContent =
                `Σ ${(s.combinedRms || 0).toFixed(2)}  ${hz}`;
        }
        if (this.hud.comfort) {
            const label = s.comfort || '--';
            this.hud.comfort.textContent = label;
            this.hud.comfort.className = `hud-push comfort-chip ${s.comfortClass || ''}`;
        }
        if (this.hud.noise) {
            const q = s.quietness == null ? '--' : String(s.quietness);
            this.hud.noise.textContent =
                `${(s.dbfs || 0).toFixed(0)}  E${(s.engineDb || 0).toFixed(0)} R${(s.roadDb || 0).toFixed(0)} W${(s.windDb || 0).toFixed(0)}  Q${q}`;
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

    comfortFill(cls) {
        if (cls === 'comfort-good') {
            return 'rgba(57, 255, 80, 0.22)';
        }
        if (cls === 'comfort-mid') {
            return 'rgba(255, 210, 0, 0.22)';
        }
        if (cls === 'comfort-bad') {
            return 'rgba(255, 122, 24, 0.22)';
        }
        if (cls === 'comfort-extreme') {
            return 'rgba(255, 59, 48, 0.22)';
        }
        return 'rgba(255, 210, 0, 0.22)';
    }

    comfortStroke(cls) {
        if (cls === 'comfort-good') {
            return '#39ff50';
        }
        if (cls === 'comfort-mid') {
            return '#ffd200';
        }
        if (cls === 'comfort-bad') {
            return '#ff7a18';
        }
        if (cls === 'comfort-extreme') {
            return '#ff3b30';
        }
        return '#ffd200';
    }

    drawComfortSegments(ctx, pts, now, w, h, maxRms) {
        if (pts.length < 2) {
            return;
        }
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 2.6;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            ctx.beginPath();
            ctx.moveTo(this.axisX(a.t, now, w), this.yOf(a.combinedRms || 0, 0, maxRms, h));
            ctx.lineTo(this.axisX(b.t, now, w), this.yOf(b.combinedRms || 0, 0, maxRms, h));
            ctx.strokeStyle = this.comfortStroke(b.comfortClass);
            ctx.stroke();
        }
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
        const maxRms = Math.max(
            1.2,
            ...pts.map((p) => Math.max(p.combinedRms || 0, p.rms || 0, p.shake || 0))
        );

        const comfortY = this.yOf(0.315, 0, maxRms, h);
        ctx.fillStyle = 'rgba(57, 255, 80, 0.07)';
        ctx.fillRect(0, comfortY, w, h - comfortY);
        ctx.fillStyle = 'rgba(255, 122, 24, 0.08)';
        ctx.fillRect(0, this.yOf(0.63, 0, maxRms, h), w, this.yOf(0.315, 0, maxRms, h) - this.yOf(0.63, 0, maxRms, h));
        ctx.fillStyle = 'rgba(255, 59, 48, 0.10)';
        ctx.fillRect(0, 0, w, this.yOf(0.63, 0, maxRms, h));

        this.label(ctx, '快適', 6, Math.min(h - 6, comfortY - 3), 'rgba(57,255,80,0.55)');
        this.label(ctx, '不快', 6, Math.max(14, this.yOf(0.63, 0, maxRms, h) + 11), 'rgba(255,59,48,0.55)');

        const last = pts[pts.length - 1] || this.snapshot;
        this.fillToBaseline(
            ctx, pts, now, w, h,
            (p) => p.combinedRms || 0, 0, maxRms,
            this.comfortFill(last.comfortClass), 0
        );
        this.strokeLine(
            ctx, pts, now, w, h,
            (p) => p.rms || 0, 0, maxRms,
            'rgba(255, 243, 214, 0.85)', 1.5
        );
        this.strokeLine(
            ctx, pts, now, w, h,
            (p) => p.shake || 0, 0, maxRms,
            '#ff7a18', 1.5
        );
        this.drawComfortSegments(ctx, pts, now, w, h, maxRms);

        const maxHz = Math.max(16, ...pts.map((p) => p.freq || 0));
        ctx.setLineDash([5, 4]);
        this.strokeLine(
            ctx, pts, now, w, h,
            (p) => p.freq || 0, 0, maxHz,
            'rgba(199, 125, 255, 0.95)', 1.7
        );
        ctx.setLineDash([]);
        this.label(ctx, `${maxHz.toFixed(0)}Hz`, w - 40, h - 6, 'rgba(199,125,255,0.75)');

        this.glowLast(
            ctx, pts, now, w, h,
            (p) => p.combinedRms || 0, 0, maxRms,
            this.comfortStroke(last.comfortClass)
        );
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
            'rgba(57, 255, 80, 0.14)', 0
        );

        const dbOf = (key) => (p) => {
            const v = p[key];
            return typeof v === 'number' ? v : yMin;
        };
        this.strokeLine(ctx, pts, now, w, h, dbOf('engineDb'), yMin, yMax, '#d47bff', 1.8);
        this.strokeLine(ctx, pts, now, w, h, dbOf('roadDb'), yMin, yMax, '#ff7a18', 1.8);
        this.strokeLine(ctx, pts, now, w, h, dbOf('windDb'), yMin, yMax, '#ffe14d', 1.8);
        this.strokeLine(ctx, pts, now, w, h, dbOf('dbfs'), yMin, yMax, '#00e5ff', 2.5);

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
