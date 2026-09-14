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
            accel: document.getElementById('hud-accel'),
            event: document.getElementById('hud-event'),
            motion: document.getElementById('hud-motion'),
            comfort: document.getElementById('hud-comfort'),
            noise: document.getElementById('hud-noise'),
            noiseSrc: document.getElementById('hud-noise-src')
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
            accelMps2: 0,
            rms: 0,
            shake: 0,
            combinedRms: 0,
            peak: 0,
            freq: 0,
            comfort: '',
            comfortClass: '',
            vibKind: 'none',
            vibLabel: '',
            vibClass: '',
            dbfs: -100,
            quietness: null,
            voice: false,
            calibrated: false,
            engineDb: -100,
            roadDb: -100,
            windDb: -100,
            engineShare: 0,
            roadShare: 0,
            windShare: 0,
            engineNoiseScore: 0,
            roadNoiseScore: 0,
            windNoiseScore: 0,
            dominant: 'none',
            engineState: 'UNKNOWN',
            driveEvent: 'none',
            drivingState: 'UNKNOWN',
            impactEvent: false
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
        if (this.hud.accel) {
            const accel = s.accelMps2 || 0;
            const sign = accel > 0.05 ? '+' : '';
            this.hud.accel.textContent = `${sign}${accel.toFixed(1)}`;
        }
        if (this.hud.event) {
            const vehicleLabels = window.DriveVehicle && window.DriveVehicle.DRIVING_STATE_LABEL;
            const labels = (window.DriveAnalysis && window.DriveAnalysis.DRIVE_EVENT_LABEL) || {};
            this.hud.event.textContent = (vehicleLabels && vehicleLabels[s.drivingState])
                || labels[s.driveEvent]
                || '--';
        }
        if (this.hud.motion) {
            this.hud.motion.textContent = `${(s.combinedRms || 0).toFixed(2)}`;
        }
        if (this.hud.comfort) {
            const label = s.comfort || '--';
            this.hud.comfort.textContent = label;
            this.hud.comfort.className = `hud-push comfort-chip ${s.comfortClass || ''}`;
        }
        if (this.hud.noise) {
            this.hud.noise.textContent = s.calibrated
                ? `${(s.dbfs || 0).toFixed(0)} dB`
                : `${(s.dbfs || 0).toFixed(0)} rel`;
        }
        if (this.hud.noiseSrc) {
            const state = s.engineState || 'UNKNOWN';
            const short = {
                ENGINE_ON: 'ON',
                ENGINE_OFF: 'OFF',
                UNKNOWN: '--'
            };
            this.hud.noiseSrc.textContent = short[state] || '--';
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
        const size = Math.max(14, Math.round(13 * (window.devicePixelRatio || 1)));
        ctx.font = `bold ${size}px Consolas, monospace`;
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

        const maxA = Math.max(
            2.5,
            ...pts.map((p) => Math.abs(p.accelMps2 || 0))
        );
        const zeroY = this.yOf(0, -maxA, maxA, h);
        ctx.strokeStyle = 'rgba(255, 122, 24, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(w, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);

        this.strokeLine(
            ctx, pts, now, w, h,
            (p) => p.accelMps2 || 0, -maxA, maxA,
            '#ff7a18', 1.9
        );
        this.glowLast(
            ctx, pts, now, w, h,
            (p) => p.accelMps2 || 0, -maxA, maxA,
            '#ff7a18'
        );
        this.label(ctx, `±${maxA.toFixed(1)}`, w - 52, 14, 'rgba(255,122,24,0.8)');
        this.markDriveEvents(ctx, pts, now, w, h, maxV);
    }

    markDriveEvents(ctx, pts, now, w, h, maxV) {
        const colors = {
            stop: '#8a8a8a',
            STOPPED: '#8a8a8a',
            launch: '#39ff50',
            LAUNCH: '#39ff50',
            cruise: '#4db8ff',
            CRUISE: '#4db8ff',
            accel: '#ffd24d',
            ACCELERATION: '#ffd24d',
            brake: '#ff3b30',
            DECELERATION: '#ff3b30'
        };
        let last = null;
        pts.forEach((p) => {
            const event = p.drivingState || p.driveEvent;
            if (!event || event === 'none' || event === last) {
                return;
            }
            last = event;
            const x = this.axisX(p.t, now, w);
            ctx.strokeStyle = colors[event] || '#ffffff';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(x, this.yOf(p.speed || 0, 0, maxV, h));
            ctx.lineTo(x, h);
            ctx.stroke();
        });
    }

    strokeSegmented(ctx, points, now, w, h, getter, yMin, yMax, colorOf, width) {
        if (points.length < 2) {
            return;
        }
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 1; i < points.length; i++) {
            ctx.beginPath();
            ctx.moveTo(this.axisX(points[i - 1].t, now, w), this.yOf(getter(points[i - 1]), yMin, yMax, h));
            ctx.lineTo(this.axisX(points[i].t, now, w), this.yOf(getter(points[i]), yMin, yMax, h));
            ctx.strokeStyle = colorOf(points[i]);
            ctx.stroke();
        }
    }

    vibScale() {
        return (window.DriveAnalysis && window.DriveAnalysis.VIB_CHART) || {
            yMax: 3,
            hzMax: 25,
            droneHigh: 0.32,
            impactHigh: 0.8
        };
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
        const scale = this.vibScale();
        const yMax = scale.yMax;
        const colors = (window.DriveAnalysis && window.DriveAnalysis.VIB_KIND_COLOR) || {
            drone: '#ffd200',
            rough: '#ff7a18',
            impact: '#ff3b30',
            none: '#ffd200'
        };
        const clampY = (value) => Math.max(0, Math.min(yMax, value || 0));

        const zone = (y0, y1, fill) => {
            const top = this.yOf(y1, 0, yMax, h);
            const bot = this.yOf(y0, 0, yMax, h);
            ctx.fillStyle = fill;
            ctx.fillRect(0, top, w, Math.max(1, bot - top));
        };
        zone(0, scale.droneHigh, 'rgba(255, 210, 0, 0.08)');
        zone(scale.droneHigh, scale.impactHigh, 'rgba(255, 122, 24, 0.08)');
        zone(scale.impactHigh, yMax, 'rgba(255, 59, 48, 0.10)');

        ctx.strokeStyle = 'rgba(255, 122, 24, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        [scale.droneHigh, scale.impactHigh].forEach((level) => {
            const y = this.yOf(level, 0, yMax, h);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        });
        ctx.setLineDash([]);

        this.fillToBaseline(
            ctx, pts, now, w, h,
            (p) => clampY(p.combinedRms), 0, yMax,
            'rgba(255, 210, 0, 0.16)', 0
        );
        this.strokeSegmented(
            ctx, pts, now, w, h,
            (p) => clampY(p.combinedRms), 0, yMax,
            (p) => colors[p.vibKind] || colors.drone,
            2.4
        );
        this.strokeLine(
            ctx, pts, now, w, h,
            (p) => clampY(p.shake || 0), 0, yMax,
            'rgba(255, 243, 214, 0.9)', 1.4
        );

        pts.forEach((p) => {
            if (p.vibKind !== 'impact' && !p.impactEvent) {
                return;
            }
            const x = this.axisX(p.t, now, w);
            ctx.fillStyle = 'rgba(255, 59, 48, 0.28)';
            ctx.fillRect(x - 1.5, 0, 3, h);
        });

        this.glowLast(
            ctx, pts, now, w, h,
            (p) => clampY(p.combinedRms), 0, yMax,
            colors[(pts[pts.length - 1] && pts[pts.length - 1].vibKind) || 'drone']
        );

        this.label(ctx, yMax.toFixed(1), 6, 14, 'rgba(255,210,0,0.75)');
        this.label(ctx, '0', 6, h - 6, 'rgba(255,210,0,0.45)');
        this.label(ctx, '路面', w - 36, this.yOf(scale.droneHigh, 0, yMax, h) - 4, 'rgba(255,210,0,0.55)');
        this.label(ctx, '衝撃', w - 36, this.yOf(scale.impactHigh, 0, yMax, h) - 4, 'rgba(255,59,48,0.7)');
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
        const yMin = calibrated ? -50 : -80;
        const yMax = calibrated ? 8 : 0;

        // 静粛性：緑の面積が大きいほど静か
        this.fillToBaseline(
            ctx, pts, now, w, h,
            (p) => p.quietness == null ? 0 : p.quietness,
            0, 100,
            'rgba(57, 255, 80, 0.14)', 0
        );

        const dbOf = (key) => (p) => {
            const v = typeof p[key] === 'number' ? p[key] : yMin;
            return Math.max(yMin, Math.min(yMax, v));
        };
        this.strokeLine(ctx, pts, now, w, h, (p) => p.engineNoiseScore || 0, 0, 100, '#d47bff', 1.5);
        this.strokeLine(ctx, pts, now, w, h, (p) => p.roadNoiseScore || 0, 0, 100, '#ff7a18', 1.5);
        this.strokeLine(ctx, pts, now, w, h, (p) => p.windNoiseScore || 0, 0, 100, '#ffe14d', 1.5);
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
            (p) => {
                const v = typeof p.dbfs === 'number' ? p.dbfs : yMin;
                return Math.max(yMin, Math.min(yMax, v));
            },
            yMin, yMax,
            '#00e5ff'
        );
        this.label(ctx, 'Q', 6, 14, 'rgba(57,255,80,0.8)');
        this.label(ctx, 'SPL', w - 32, 14, 'rgba(0,229,255,0.85)');
    }
}

window.NervCharts = NervCharts;
