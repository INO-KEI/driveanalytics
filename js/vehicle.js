// vehicle.js
// Layer 0–5: データ品質 → 走行状態 → 車体挙動 → パワートレーン → 騒音 → 車両特性
// Legacy の engine/road/wind 100%配分とは独立に並行稼働する

(function (global) {
    const A = function () {
        return global.DriveAnalysis;
    };

    const CONFIG = {
        realisticMaxSpeedKmh: 180,
        impossibleAccelKmhPerSec: 100,
        gpsAccuracyGoodM: 15,
        gpsAccuracyPoorM: 50,
        speedMedianWindow: 5,
        speedEmaAlpha: 0.42,
        stoppedSpeedKmh: 2,
        launchHoldMs: 4500,
        launchMaxSpeedKmh: 28,
        accelThresholdMps2: 0.45,
        decelThresholdMps2: -0.50,
        cruiseAccelAbsMps2: 0.38,
        cruiseSpeedStdKmh: 3.5,
        engineOnThreshold: 0.70,
        engineOffThreshold: 0.30,
        engineHoldMs: 2200,
        engineNoiseGate: 0.45,
        impactPeakMps2: 0.90,
        impactCrest: 3.0,
        audioDeltaWindowSec: 4,
        persistNeedSec: 2.2,
        historySec: 12,
        lowSpeedMinKmh: 10,
        lowSpeedMaxKmh: 20
    };

    function mergeStoredConfig(base) {
        try {
            const raw = global.localStorage && localStorage.getItem('driveanalytics.vehicleConfig');
            if (!raw) {
                return base;
            }
            const extra = JSON.parse(raw);
            const out = Object.assign({}, base);
            Object.keys(extra || {}).forEach(function (key) {
                if (typeof extra[key] === 'number' && isFinite(extra[key])) {
                    out[key] = extra[key];
                }
            });
            return out;
        } catch (error) {
            return base;
        }
    }

    const DRIVING_STATE = {
        STOPPED: 'STOPPED',
        LAUNCH: 'LAUNCH',
        ACCELERATION: 'ACCELERATION',
        CRUISE: 'CRUISE',
        DECELERATION: 'DECELERATION',
        UNKNOWN: 'UNKNOWN'
    };

    const DRIVING_STATE_LABEL = {
        STOPPED: '停止',
        LAUNCH: '発進',
        ACCELERATION: '加速',
        CRUISE: '定常',
        DECELERATION: '減速',
        UNKNOWN: '--'
    };

    const ENGINE_STATE = {
        ON: 'ENGINE_ON',
        OFF: 'ENGINE_OFF',
        UNKNOWN: 'UNKNOWN'
    };

    const POWERTRAIN_TRANSITION = {
        NONE: 'NONE',
        START_CANDIDATE: 'START_CANDIDATE',
        STOP_CANDIDATE: 'STOP_CANDIDATE',
        STATE_CHANGE: 'STATE_CHANGE'
    };

    const SPEED_BANDS = [
        { id: '0-2', min: 0, max: 2 },
        { id: '2-10', min: 2, max: 10 },
        { id: '10-20', min: 10, max: 20 },
        { id: '20-30', min: 20, max: 30 },
        { id: '30-40', min: 30, max: 40 },
        { id: '40-60', min: 40, max: 60 },
        { id: '60+', min: 60, max: 1000 }
    ];

    const AUDIO_BANDS = [
        { key: 'lf', low: 20, high: 80 },
        { key: 'power', low: 80, high: 250 },
        { key: 'mid', low: 250, high: 500 },
        { key: 'upper', low: 500, high: 1000 },
        { key: 'high', low: 1000, high: 8000 },
        { key: 'broadband', low: 250, high: 1600 },
        { key: 'aero', low: 1600, high: 8000 }
    ];

    const CSV_COLUMNS = [
        'raw_speed',
        'filtered_speed',
        'gps_valid',
        'gps_confidence',
        'driving_state',
        'continuous_vibration',
        'shake_score',
        'impact_score',
        'impact_event',
        'longitudinal_motion',
        'vertical_motion',
        'lateral_motion',
        'engine_probability',
        'engine_state',
        'engine_start_probability',
        'engine_stop_probability',
        'powertrain_transition',
        'ev_likelihood',
        'engine_noise_score',
        'road_noise_score',
        'wind_noise_score',
        'audio_delta',
        'vibration_delta',
        'quietness_score',
        'ride_comfort_score',
        'powertrain_smoothness_score',
        'ride_vibration_score',
        'ride_shake_score',
        'ride_impact_score',
        'ride_stability_score',
        'engine_debug'
    ];

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function clamp01(value) {
        return clamp(value, 0, 1);
    }

    function hypot3(x, y, z) {
        return Math.sqrt(x * x + y * y + z * z);
    }

    function median(values) {
        if (!values.length) {
            return 0;
        }
        const sorted = values.slice().sort(function (a, b) { return a - b; });
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function mean(values) {
        if (!values.length) {
            return 0;
        }
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            sum += values[i];
        }
        return sum / values.length;
    }

    function stdev(values) {
        if (values.length < 2) {
            return 0;
        }
        const m = mean(values);
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            const d = values[i] - m;
            sum += d * d;
        }
        return Math.sqrt(sum / values.length);
    }

    function powerToDb(power) {
        return 10 * Math.log10(Math.max(power, 1e-12));
    }

    function dbDelta(current, baseline) {
        if (!isFinite(current) || !isFinite(baseline)) {
            return 0;
        }
        return current - baseline;
    }

    function pearson(xs, ys) {
        const n = Math.min(xs.length, ys.length);
        if (n < 8) {
            return 0;
        }
        let sx = 0;
        let sy = 0;
        let sxx = 0;
        let syy = 0;
        let sxy = 0;
        for (let i = 0; i < n; i++) {
            const x = xs[i];
            const y = ys[i];
            sx += x;
            sy += y;
            sxx += x * x;
            syy += y * y;
            sxy += x * y;
        }
        const cov = sxy - (sx * sy) / n;
        const vx = sxx - (sx * sx) / n;
        const vy = syy - (sy * sy) / n;
        if (vx <= 1e-12 || vy <= 1e-12) {
            return 0;
        }
        return clamp(cov / Math.sqrt(vx * vy), -1, 1);
    }

    function levelFromScore(score, low, high) {
        if (score >= high) {
            return 'High';
        }
        if (score <= low) {
            return 'Low';
        }
        return 'Medium';
    }

    function qualityFromScore(score, good, poor) {
        if (score >= good) {
            return 'Good';
        }
        if (score <= poor) {
            return 'Poor';
        }
        return 'Fair';
    }

    function freqLabel(count) {
        if (count >= 6) {
            return 'Frequent';
        }
        if (count <= 1) {
            return 'Rare';
        }
        return 'Moderate';
    }

    function audioLayerBands(freqDb, sampleRate, fftSize) {
        const DA = A();
        const out = {};
        AUDIO_BANDS.forEach(function (band) {
            const power = DA && DA.bandIntegratedPower
                ? DA.bandIntegratedPower(freqDb, sampleRate, fftSize, band.low, band.high)
                : 0;
            out[band.key] = powerToDb(power);
        });
        return out;
    }

    function deviceToWorld(alpha, beta, gamma, vec) {
        const z = (alpha || 0) * Math.PI / 180;
        const x = (beta || 0) * Math.PI / 180;
        const y = (gamma || 0) * Math.PI / 180;
        const cz = Math.cos(z);
        const sz = Math.sin(z);
        const cx = Math.cos(x);
        const sx = Math.sin(x);
        const cy = Math.cos(y);
        const sy = Math.sin(y);
        const m00 = cz * cy - sz * sx * sy;
        const m01 = -sz * cx;
        const m02 = cz * sy + sz * sx * cy;
        const m10 = sz * cy + cz * sx * sy;
        const m11 = cz * cx;
        const m12 = sz * sy - cz * sx * cy;
        const m20 = -cx * sy;
        const m21 = sx;
        const m22 = cx * cy;
        return {
            x: m00 * vec.x + m01 * vec.y + m02 * vec.z,
            y: m10 * vec.x + m11 * vec.y + m12 * vec.z,
            z: m20 * vec.x + m21 * vec.y + m22 * vec.z
        };
    }

    function emptySnapshot(cfg) {
        return {
            rawSpeed: 0,
            filteredSpeed: 0,
            gpsValid: false,
            gpsConfidence: 0,
            drivingState: DRIVING_STATE.UNKNOWN,
            continuousVibration: 0,
            shakeScore: 0,
            impactScore: 0,
            impactEvent: false,
            longitudinalMotion: 0,
            verticalMotion: 0,
            lateralMotion: 0,
            engineProbability: 0,
            engineState: ENGINE_STATE.UNKNOWN,
            engineStartProbability: 0,
            engineStopProbability: 0,
            powertrainTransition: POWERTRAIN_TRANSITION.NONE,
            evLikelihood: 0,
            engineNoiseScore: 0,
            roadNoiseScore: 0,
            windNoiseScore: 0,
            audioDelta: 0,
            vibrationDelta: 0,
            quietnessScore: null,
            rideComfortScore: null,
            powertrainSmoothnessScore: null,
            rideVibrationScore: 0,
            rideShakeScore: 0,
            rideImpactScore: 0,
            rideStabilityScore: 100,
            engineFactors: {
                lowFrequencyRise: 0,
                powerBandRise: 0,
                vibrationRise: 0,
                persistence: 0
            },
            soundLabel: 'Relative Sound Level',
            config: cfg
        };
    }

    class VehicleAnalyzer {
        constructor(config) {
            this.config = mergeStoredConfig(Object.assign({}, CONFIG, config || {}));
            this.reset();
        }

        reset() {
            this.speedHist = [];
            this.validSpeedHist = [];
            this.filteredSpeed = 0;
            this.haveFiltered = false;
            this.lastGpsTs = 0;
            this.lastValidTs = 0;
            this.gpsValid = false;
            this.gpsConfidence = 0;
            this.rawSpeed = 0;
            this.longAccel = 0;
            this.orientation = null;
            this.heading = null;
            this.drivingState = DRIVING_STATE.UNKNOWN;
            this.launchUntil = 0;
            this.stateSince = 0;
            this.engineState = ENGINE_STATE.UNKNOWN;
            this.engineProb = 0;
            this.engineHold = { target: null, since: 0 };
            this.lastEngineState = ENGINE_STATE.UNKNOWN;
            this.motionWin = [];
            this.audioWin = [];
            this.metricWin = [];
            this.impactHoldUntil = 0;
            this.impactScore = 0;
            this.riseStreakMs = 0;
            this.dropStreakMs = 0;
            this.lastTick = 0;
            this.snapshot = emptySnapshot(this.config);
            this.liveQuiet = [];
            this.liveRide = [];
            this.livePt = [];
            this.transitionEvents = [];
        }

        setOrientation(orientation) {
            this.orientation = orientation;
        }

        ingestGps(input) {
            const cfg = this.config;
            const ts = input.timestamp || Date.now();
            const raw = Number(input.rawSpeed);
            const accuracy = input.accuracy;
            const dt = this.lastGpsTs ? (ts - this.lastGpsTs) / 1000 : 0;
            this.lastGpsTs = ts;
            this.rawSpeed = isFinite(raw) ? raw : 0;
            if (input.heading != null && isFinite(input.heading)) {
                this.heading = input.heading;
            }

            let valid = isFinite(raw) && raw >= 0 && raw <= cfg.realisticMaxSpeedKmh;
            let reason = valid ? 'ok' : 'range';
            if (valid && this.haveFiltered && dt > 0.05 && dt < 5) {
                const jump = Math.abs(raw - this.filteredSpeed) / dt;
                if (jump > cfg.impossibleAccelKmhPerSec) {
                    valid = false;
                    reason = 'accel';
                }
            }
            if (accuracy != null && accuracy > 120 && raw > 8) {
                valid = false;
                reason = 'accuracy';
            }

            let confidence = 0;
            if (valid) {
                confidence = 1;
                if (accuracy != null) {
                    if (accuracy > cfg.gpsAccuracyPoorM) {
                        confidence = 0.35;
                    } else if (accuracy > cfg.gpsAccuracyGoodM) {
                        confidence = 0.7;
                    }
                }
                if (this.haveFiltered && dt > 0.05) {
                    const jump = Math.abs(raw - this.filteredSpeed) / Math.max(dt, 0.2);
                    if (jump > cfg.impossibleAccelKmhPerSec * 0.45) {
                        confidence *= 0.55;
                    }
                }
            }

            this.gpsValid = valid;
            this.gpsConfidence = clamp01(confidence);
            this.speedHist.push({ t: ts, speed: this.rawSpeed, valid: valid, reason: reason });
            this.trim(this.speedHist, ts, 8000);

            if (valid) {
                this.lastValidTs = ts;
                this.validSpeedHist.push({ t: ts, speed: this.rawSpeed });
                this.trim(this.validSpeedHist, ts, 8000);
                const windowN = cfg.speedMedianWindow;
                const recent = this.validSpeedHist.slice(-windowN).map(function (item) {
                    return item.speed;
                });
                const med = median(recent);
                const prevFiltered = this.haveFiltered ? this.filteredSpeed : med;
                if (!this.haveFiltered) {
                    this.filteredSpeed = med;
                    this.haveFiltered = true;
                } else {
                    const alpha = cfg.speedEmaAlpha;
                    this.filteredSpeed = alpha * med + (1 - alpha) * this.filteredSpeed;
                }
                if (dt > 0.12 && dt < 2.5) {
                    const rawAccel = ((this.filteredSpeed - prevFiltered) / 3.6) / dt;
                    if (isFinite(rawAccel)) {
                        this.longAccel = this.longAccel * 0.62 + clamp(rawAccel, -8, 8) * 0.38;
                    }
                }
            } else if (this.haveFiltered && dt >= 2.5) {
                this.longAccel *= 0.5;
            }

            this.updateDrivingState(ts);
            this.syncSnapshot();
            return {
                gpsValid: this.gpsValid,
                gpsConfidence: this.gpsConfidence,
                rawSpeed: this.rawSpeed,
                filteredSpeed: this.haveFiltered ? this.filteredSpeed : 0,
                longAccel: this.longAccel,
                drivingState: this.drivingState,
                reason: reason
            };
        }

        updateDrivingState(ts) {
            const cfg = this.config;
            const recent = this.validSpeedHist.filter(function (item) {
                return ts - item.t <= 3500;
            }).map(function (item) {
                return item.speed;
            });
            const gpsAge = this.lastValidTs ? ts - this.lastValidTs : 1e9;
            const gpsFresh = gpsAge < 2500;
            const medSpeed = recent.length ? median(recent) : (this.haveFiltered ? this.filteredSpeed : 0);
            const current = this.haveFiltered ? this.filteredSpeed : medSpeed;
            const speedStd = stdev(recent);
            const accel = this.longAccel;
            const prev = this.drivingState;
            let next = prev;
            const movingNow = current >= cfg.stoppedSpeedKmh;
            const stoppedNow = medSpeed < cfg.stoppedSpeedKmh && current < cfg.stoppedSpeedKmh + 0.8;
            const slowing = accel <= cfg.decelThresholdMps2 && current + 1.2 < medSpeed;
            const speeding = accel >= cfg.accelThresholdMps2;

            if (!gpsFresh && !this.haveFiltered) {
                next = DRIVING_STATE.UNKNOWN;
            } else if (stoppedNow) {
                next = DRIVING_STATE.STOPPED;
                this.launchUntil = 0;
            } else if ((prev === DRIVING_STATE.STOPPED || prev === DRIVING_STATE.UNKNOWN) && movingNow) {
                next = DRIVING_STATE.LAUNCH;
                this.launchUntil = ts + cfg.launchHoldMs;
            } else if (ts < this.launchUntil && current < cfg.launchMaxSpeedKmh && !slowing) {
                next = DRIVING_STATE.LAUNCH;
            } else if (slowing) {
                next = DRIVING_STATE.DECELERATION;
            } else if (speeding && current >= 8) {
                next = DRIVING_STATE.ACCELERATION;
            } else if (Math.abs(accel) < cfg.cruiseAccelAbsMps2 && speedStd < cfg.cruiseSpeedStdKmh && current >= 8) {
                next = DRIVING_STATE.CRUISE;
            } else if (prev === DRIVING_STATE.UNKNOWN || prev === DRIVING_STATE.STOPPED) {
                next = current >= 22 ? DRIVING_STATE.CRUISE : DRIVING_STATE.ACCELERATION;
            } else {
                next = prev;
            }

            if (next !== prev) {
                this.stateSince = ts;
            }
            this.drivingState = next;
        }

        ingestMotion(input) {
            const cfg = this.config;
            const ts = Date.now();
            const linX = input.linX || 0;
            const linY = input.linY || 0;
            const linZ = input.linZ || 0;
            let vertical = input.vertical;
            let horizontal = input.horizontal;
            if (vertical == null) {
                vertical = 0;
            }
            if (horizontal == null) {
                horizontal = hypot3(linX, linY, linZ);
            }

            let longInst = Math.abs(this.longAccel);
            let latInst = horizontal;
            let vertInst = Math.abs(vertical);

            if (this.orientation && this.heading != null && isFinite(this.heading)) {
                const world = deviceToWorld(
                    this.orientation.alpha,
                    this.orientation.beta,
                    this.orientation.gamma,
                    { x: linX, y: linY, z: linZ }
                );
                const yaw = (this.heading || 0) * Math.PI / 180;
                const east = world.x;
                const north = world.y;
                const fwd = north * Math.cos(yaw) + east * Math.sin(yaw);
                const lat = -north * Math.sin(yaw) + east * Math.cos(yaw);
                longInst = Math.abs(fwd);
                latInst = Math.abs(lat);
                vertInst = Math.abs(world.z);
            }

            const mag = hypot3(linX, linY, linZ);
            this.motionWin.push({
                t: ts,
                mag: mag,
                vert: vertInst,
                long: longInst,
                lat: latInst,
                horiz: horizontal
            });
            this.trim(this.motionWin, ts, 1400);

            const n = this.motionWin.length;
            let sumSq = 0;
            let vertSq = 0;
            let longSq = 0;
            let latSq = 0;
            let horizSq = 0;
            let peak = 0;
            for (let i = 0; i < n; i++) {
                const s = this.motionWin[i];
                sumSq += s.mag * s.mag;
                vertSq += s.vert * s.vert;
                longSq += s.long * s.long;
                latSq += s.lat * s.lat;
                horizSq += s.horiz * s.horiz;
                peak = Math.max(peak, s.mag);
            }
            const cont = n ? Math.sqrt(sumSq / n) : 0;
            const vertRms = n ? Math.sqrt(vertSq / n) : 0;
            const longRms = n ? Math.sqrt(longSq / n) : 0;
            const latRms = n ? Math.sqrt(latSq / n) : 0;
            const shake = n ? Math.sqrt(horizSq / n) : (input.shake || 0);
            const rms = cont > 1e-6 ? cont : 1e-6;
            const crest = peak / rms;
            const impactNow = peak >= cfg.impactPeakMps2 || (crest >= cfg.impactCrest && peak >= 0.5);
            if (impactNow) {
                this.impactHoldUntil = ts + 800;
                this.impactScore = Math.max(this.impactScore, clamp(peak / 2.2 * 100, 0, 100));
            } else if (ts > this.impactHoldUntil) {
                this.impactScore *= 0.82;
                if (this.impactScore < 2) {
                    this.impactScore = 0;
                }
            }

            this.snapshot.continuousVibration = cont;
            this.snapshot.shakeScore = shake;
            this.snapshot.impactScore = this.impactScore;
            this.snapshot.impactEvent = ts < this.impactHoldUntil;
            this.snapshot.verticalMotion = vertRms;
            this.snapshot.longitudinalMotion = Math.max(longRms, Math.abs(this.longAccel));
            this.snapshot.lateralMotion = latRms;
            this.snapshot.rideVibrationScore = clamp(cont / 0.85 * 100, 0, 100);
            this.snapshot.rideShakeScore = clamp(shake / 0.75 * 100, 0, 100);
            this.snapshot.rideImpactScore = this.impactScore;
            this.snapshot.rideStabilityScore = clamp(
                100 - this.snapshot.rideShakeScore * 0.45 - this.snapshot.rideImpactScore * 0.35 - this.snapshot.rideVibrationScore * 0.2,
                0,
                100
            );
            this.syncSnapshot();
        }

        ingestAudio(input) {
            const ts = Date.now();
            let bandDb = input.bandDb;
            if (!bandDb && input.freqDb && input.sampleRate && input.fftSize) {
                bandDb = audioLayerBands(input.freqDb, input.sampleRate, input.fftSize);
            }
            bandDb = bandDb || {};
            this.audioWin.push({
                t: ts,
                dbfs: input.dbfs,
                voice: Boolean(input.voice),
                lf: bandDb.lf || -100,
                power: bandDb.power || -100,
                mid: bandDb.mid || -100,
                upper: bandDb.upper || -100,
                high: bandDb.high || -100,
                broadband: bandDb.broadband || -100,
                aero: bandDb.aero || -100
            });
            this.trim(this.audioWin, ts, this.config.historySec * 1000);
            this.syncSnapshot();
        }

        tick(now) {
            now = now || Date.now();
            const dtMs = this.lastTick ? now - this.lastTick : 1000;
            this.lastTick = now;
            this.updatePowertrain(now, dtMs);
            this.updateNoiseScores(now);
            this.updateAxisScores(now);
            this.syncSnapshot();
            return this.snapshot;
        }

        recentAudio(now, fromAgo, toAgo) {
            return this.audioWin.filter(function (item) {
                const age = now - item.t;
                return age >= toAgo && age <= fromAgo && !item.voice;
            });
        }

        baselineAudio(now) {
            const cfg = this.config;
            const past = this.recentAudio(now, (cfg.audioDeltaWindowSec + 1) * 1000, 900);
            if (!past.length) {
                return null;
            }
            return {
                lf: median(past.map(function (item) { return item.lf; })),
                power: median(past.map(function (item) { return item.power; })),
                mid: median(past.map(function (item) { return item.mid; })),
                high: median(past.map(function (item) { return item.high; })),
                broadband: median(past.map(function (item) { return item.broadband; })),
                aero: median(past.map(function (item) { return item.aero; })),
                dbfs: median(past.map(function (item) { return item.dbfs; }))
            };
        }

        currentAudio() {
            for (let i = this.audioWin.length - 1; i >= 0; i--) {
                if (!this.audioWin[i].voice) {
                    return this.audioWin[i];
                }
            }
            return this.audioWin[this.audioWin.length - 1] || null;
        }

        updatePowertrain(now, dtMs) {
            const cfg = this.config;
            const cur = this.currentAudio();
            const base = this.baselineAudio(now);
            const vibNow = this.snapshot.continuousVibration || 0;
            const shakeNow = this.snapshot.shakeScore || 0;
            const pastVib = this.metricWin.filter(function (item) {
                const age = now - item.t;
                return age >= 900 && age <= (cfg.audioDeltaWindowSec + 1) * 1000;
            });
            const vibBase = pastVib.length
                ? median(pastVib.map(function (item) { return item.vibration; }))
                : vibNow;
            const lfRise = base && cur ? clamp01(dbDelta(cur.lf, base.lf) / 6) : 0;
            const powerRise = base && cur ? clamp01(dbDelta(cur.power, base.power) / 6) : 0;
            const lfDrop = base && cur ? clamp01(dbDelta(base.lf, cur.lf) / 6) : 0;
            const powerDrop = base && cur ? clamp01(dbDelta(base.power, cur.power) / 6) : 0;
            const vibMixNow = hypot3(vibNow, shakeNow, 0);
            const vibRise = clamp01((vibMixNow - vibBase) / 0.14);
            const vibDrop = clamp01((vibBase - vibMixNow) / 0.14);
            const audioDelta = base && cur
                ? 0.55 * dbDelta(cur.lf, base.lf) + 0.45 * dbDelta(cur.power, base.power)
                : 0;
            const vibrationDelta = vibMixNow - vibBase;

            const rising = lfRise > 0.28 || powerRise > 0.28 || vibRise > 0.32;
            const falling = lfDrop > 0.28 || powerDrop > 0.28 || vibDrop > 0.32;
            if (rising) {
                this.riseStreakMs += dtMs;
                this.dropStreakMs = 0;
            } else if (falling) {
                this.dropStreakMs += dtMs;
                this.riseStreakMs = 0;
            } else {
                this.riseStreakMs = Math.max(0, this.riseStreakMs - dtMs * 0.5);
                this.dropStreakMs = Math.max(0, this.dropStreakMs - dtMs * 0.5);
            }
            const persist = clamp01(this.riseStreakMs / (cfg.persistNeedSec * 1000));
            const persistDrop = clamp01(this.dropStreakMs / (cfg.persistNeedSec * 1000));
            const launchContext = this.drivingState === DRIVING_STATE.LAUNCH
                || (this.filteredSpeed >= cfg.lowSpeedMinKmh && this.filteredSpeed <= cfg.lowSpeedMaxKmh);

            const startP = clamp01(
                0.30 * lfRise + 0.20 * powerRise + 0.32 * vibRise + 0.18 * persist
                + (launchContext ? 0.08 : 0)
            );
            const stopP = clamp01(0.34 * lfDrop + 0.22 * powerDrop + 0.28 * vibDrop + 0.16 * persistDrop);

            const stoppedQuiet = this.drivingState === DRIVING_STATE.STOPPED
                && vibNow < 0.09
                && Math.abs(audioDelta) < 2.2
                && Math.abs(vibrationDelta) < 0.05;

            let engineP = 0.42 * startP + 0.18 * persist + 0.12 * lfRise + 0.12 * powerRise + 0.16 * vibRise;
            engineP -= 0.55 * stopP;
            if (stoppedQuiet) {
                engineP -= 0.62;
            }
            if (launchContext && startP > 0.42 && persist > 0.35) {
                engineP += 0.08;
            }
            if (this.engineState === ENGINE_STATE.ON) {
                engineP += 0.06;
            }
            engineP = clamp01(engineP);

            this.applyEngineHysteresis(now, engineP);

            let transition = POWERTRAIN_TRANSITION.NONE;
            if (this.engineState !== this.lastEngineState && this.lastEngineState !== ENGINE_STATE.UNKNOWN && this.engineState !== ENGINE_STATE.UNKNOWN) {
                transition = POWERTRAIN_TRANSITION.STATE_CHANGE;
                this.transitionEvents.push({ t: now, speed: this.filteredSpeed, state: this.drivingState });
            } else if (startP > 0.42 && persist > 0.28 && this.engineState !== ENGINE_STATE.ON) {
                transition = POWERTRAIN_TRANSITION.START_CANDIDATE;
            } else if (stopP > 0.42 && persistDrop > 0.28 && this.engineState !== ENGINE_STATE.OFF) {
                transition = POWERTRAIN_TRANSITION.STOP_CANDIDATE;
            }
            this.lastEngineState = this.engineState;

            let ev = 0;
            if (this.engineState === ENGINE_STATE.OFF) {
                ev = clamp01(0.55 + 0.35 * (1 - engineP) + (stoppedQuiet ? 0.15 : 0));
            } else if (this.engineState === ENGINE_STATE.ON) {
                ev = clamp01(0.22 * (1 - engineP));
            } else {
                ev = clamp01(0.45 * (1 - engineP) + (stoppedQuiet ? 0.25 : 0));
            }

            this.engineProb = engineP;
            this.snapshot.engineProbability = engineP;
            this.snapshot.engineState = this.engineState;
            this.snapshot.engineStartProbability = startP;
            this.snapshot.engineStopProbability = stopP;
            this.snapshot.powertrainTransition = transition;
            this.snapshot.evLikelihood = ev;
            this.snapshot.audioDelta = audioDelta;
            this.snapshot.vibrationDelta = vibrationDelta;
            this.snapshot.engineFactors = {
                lowFrequencyRise: round4(lfRise),
                powerBandRise: round4(powerRise),
                vibrationRise: round4(vibRise),
                persistence: round4(persist)
            };
        }

        applyEngineHysteresis(now, engineP) {
            const cfg = this.config;
            let target = null;
            if (engineP >= cfg.engineOnThreshold) {
                target = ENGINE_STATE.ON;
            } else if (engineP <= cfg.engineOffThreshold) {
                target = ENGINE_STATE.OFF;
            }

            if (this.engineState === ENGINE_STATE.UNKNOWN) {
                if (target && (!this.engineHold.target || this.engineHold.target !== target)) {
                    this.engineHold = { target: target, since: now };
                }
                if (target && this.engineHold.target === target && now - this.engineHold.since >= cfg.engineHoldMs) {
                    this.engineState = target;
                    this.engineHold = { target: null, since: 0 };
                }
                return;
            }

            if (!target || target === this.engineState) {
                this.engineHold = { target: null, since: 0 };
                return;
            }
            if (this.engineHold.target !== target) {
                this.engineHold = { target: target, since: now };
                return;
            }
            if (now - this.engineHold.since >= cfg.engineHoldMs) {
                this.engineState = target;
                this.engineHold = { target: null, since: 0 };
            }
        }

        updateNoiseScores(now) {
            const cur = this.currentAudio();
            if (!cur) {
                return;
            }
            const speed = this.filteredSpeed || 0;
            const engineGate = this.engineProb;
            const engineRaw = dbToNoiseScore(Math.max(cur.lf, cur.power));
            const engineScore = engineGate < this.config.engineNoiseGate
                ? engineRaw * engineGate
                : engineRaw;
            const speedRoad = clamp01(speed / 80);
            const speedWind = clamp01(Math.pow(Math.max(0, speed - 25) / 70, 1.15));
            const vib = this.snapshot.continuousVibration || 0;
            const vert = this.snapshot.verticalMotion || 0;
            const speeds = this.metricWin.map(function (item) { return item.speed; });
            const roads = this.metricWin.map(function (item) { return item.broadband; });
            const winds = this.metricWin.map(function (item) { return item.aero; });
            const verts = this.metricWin.map(function (item) { return item.vertical; });
            const roadCorr = Math.max(0, pearson(speeds, roads));
            const windCorr = Math.max(0, pearson(speeds, winds));
            const roadVib = Math.max(0, pearson(verts, roads));
            const windVib = pearson(verts, winds);

            const roadScore = clamp(
                dbToNoiseScore(cur.broadband) * 0.62
                + speedRoad * 22
                + roadCorr * 10
                + clamp(vert / 0.5, 0, 1) * 8
                + roadVib * 6,
                0,
                100
            );
            const windScore = clamp(
                dbToNoiseScore(cur.aero) * 0.58
                + speedWind * 28
                + windCorr * 12
                - clamp(windVib, 0, 1) * 10
                - clamp(vib / 0.6, 0, 1) * 8,
                0,
                100
            );

            this.snapshot.engineNoiseScore = clamp(engineScore, 0, 100);
            this.snapshot.roadNoiseScore = roadScore;
            this.snapshot.windNoiseScore = windScore;
        }

        updateAxisScores(now) {
            const s = this.snapshot;
            const cur = this.currentAudio();
            const overall = cur ? dbToNoiseScore(cur.dbfs) : 40;
            const quiet = clamp(
                100 - overall * 0.46 - (s.roadNoiseScore || 0) * 0.22
                - (s.windNoiseScore || 0) * 0.16 - (s.engineNoiseScore || 0) * 0.16,
                0,
                100
            );
            const ride = clamp(
                100 - (s.rideVibrationScore || 0) * 0.34 - (s.rideShakeScore || 0) * 0.28
                - (s.rideImpactScore || 0) * 0.22 - clamp((s.verticalMotion || 0) / 0.7, 0, 1) * 16,
                0,
                100
            );
            const lowSpeed = s.drivingState === DRIVING_STATE.LAUNCH
                || ((this.filteredSpeed || 0) >= 8 && (this.filteredSpeed || 0) <= 22);
            const transPen = s.powertrainTransition === POWERTRAIN_TRANSITION.NONE ? 0 : 18;
            const pt = clamp(
                100 - Math.abs(s.audioDelta || 0) * 3.2 - Math.abs(s.vibrationDelta || 0) * 90
                - (lowSpeed ? (s.rideShakeScore || 0) * 0.22 : 0) - transPen,
                0,
                100
            );
            this.liveQuiet.push(quiet);
            this.liveRide.push(ride);
            this.livePt.push(pt);
            if (this.liveQuiet.length > 20) {
                this.liveQuiet.shift();
                this.liveRide.shift();
                this.livePt.shift();
            }
            s.quietnessScore = Math.round(mean(this.liveQuiet));
            s.rideComfortScore = Math.round(mean(this.liveRide));
            s.powertrainSmoothnessScore = Math.round(mean(this.livePt));

            this.metricWin.push({
                t: now,
                speed: this.filteredSpeed || 0,
                vibration: s.continuousVibration || 0,
                shake: s.shakeScore || 0,
                vertical: s.verticalMotion || 0,
                broadband: cur ? cur.broadband : -100,
                aero: cur ? cur.aero : -100,
                drivingState: this.drivingState,
                quiet: quiet,
                ride: ride,
                pt: pt,
                audioDelta: s.audioDelta || 0,
                vibrationDelta: s.vibrationDelta || 0,
                transition: s.powertrainTransition
            });
            this.trim(this.metricWin, now, this.config.historySec * 1000);
        }

        syncSnapshot() {
            const s = this.snapshot;
            s.rawSpeed = this.rawSpeed;
            s.filteredSpeed = this.haveFiltered ? this.filteredSpeed : 0;
            s.gpsValid = this.gpsValid;
            s.gpsConfidence = this.gpsConfidence;
            s.drivingState = this.drivingState;
            s.soundLabel = 'Relative Sound Level';
            s.config = this.config;
        }

        getSnapshot() {
            const now = Date.now();
            if (!this.lastTick || now - this.lastTick > 280) {
                this.tick(now);
            }
            return this.snapshot;
        }

        buildSample() {
            this.tick(Date.now());
            const s = this.snapshot;
            return {
                rawSpeed: s.rawSpeed,
                filteredSpeed: s.filteredSpeed,
                gpsValid: s.gpsValid,
                gpsConfidence: s.gpsConfidence,
                drivingState: s.drivingState,
                continuousVibration: s.continuousVibration,
                shakeScore: s.shakeScore,
                impactScore: s.impactScore,
                impactEvent: s.impactEvent,
                longitudinalMotion: s.longitudinalMotion,
                verticalMotion: s.verticalMotion,
                lateralMotion: s.lateralMotion,
                engineProbability: s.engineProbability,
                engineState: s.engineState,
                engineStartProbability: s.engineStartProbability,
                engineStopProbability: s.engineStopProbability,
                powertrainTransition: s.powertrainTransition,
                evLikelihood: s.evLikelihood,
                engineNoiseScore: s.engineNoiseScore,
                roadNoiseScore: s.roadNoiseScore,
                windNoiseScore: s.windNoiseScore,
                audioDelta: s.audioDelta,
                vibrationDelta: s.vibrationDelta,
                quietnessScore: s.quietnessScore,
                rideComfortScore: s.rideComfortScore,
                powertrainSmoothnessScore: s.powertrainSmoothnessScore,
                rideVibrationScore: s.rideVibrationScore,
                rideShakeScore: s.rideShakeScore,
                rideImpactScore: s.rideImpactScore,
                rideStabilityScore: s.rideStabilityScore,
                engineFactors: s.engineFactors,
                engineDebug: JSON.stringify({
                    engineProbability: round4(s.engineProbability),
                    factors: s.engineFactors
                })
            };
        }

        finalize(points) {
            return summarizeSession(points || []);
        }

        trim(list, now, windowMs) {
            while (list.length && now - list[0].t > windowMs) {
                list.shift();
            }
        }
    }

    function dbToNoiseScore(db) {
        if (!isFinite(db)) {
            return 0;
        }
        return clamp((db + 72) / 52 * 100, 0, 100);
    }

    function round4(value) {
        return Math.round((value || 0) * 1000) / 1000;
    }

    function bandOfSpeed(speed) {
        for (let i = 0; i < SPEED_BANDS.length; i++) {
            if (speed >= SPEED_BANDS[i].min && speed < SPEED_BANDS[i].max) {
                return SPEED_BANDS[i].id;
            }
        }
        return SPEED_BANDS[SPEED_BANDS.length - 1].id;
    }

    function aggregate(points, keyFn) {
        const groups = {};
        points.forEach(function (point) {
            const key = keyFn(point);
            if (!groups[key]) {
                groups[key] = {
                    id: key,
                    n: 0,
                    vib: 0,
                    shake: 0,
                    noise: 0,
                    transition: 0,
                    impact: 0,
                    engineP: 0
                };
            }
            const g = groups[key];
            g.n += 1;
            g.vib += point.continuousVibration || 0;
            g.shake += point.shakeScore != null ? point.shakeScore : (point.shake || 0);
            g.noise += point.dbfs || 0;
            g.impact += point.impactScore || 0;
            g.engineP += point.engineProbability || 0;
            if (point.powertrainTransition && point.powertrainTransition !== POWERTRAIN_TRANSITION.NONE) {
                g.transition += 1;
            }
        });
        return Object.keys(groups).map(function (key) {
            const g = groups[key];
            const n = g.n || 1;
            return {
                id: g.id,
                count: g.n,
                vibration: g.vib / n,
                shake: g.shake / n,
                noise: g.noise / n,
                impact: g.impact / n,
                engineProbability: g.engineP / n,
                powertrainTransition: g.transition
            };
        });
    }

    function summarizeSession(points) {
        const moving = points.filter(function (p) {
            return (p.filteredSpeed != null ? p.filteredSpeed : p.speed || 0) >= 2;
        });
        const used = moving.length ? moving : points;
        const avg = function (key) {
            if (!used.length) {
                return null;
            }
            return mean(used.map(function (p) { return p[key] || 0; }));
        };
        const quiet = used.length ? Math.round(mean(used.map(function (p) {
            return p.quietnessScore != null ? p.quietnessScore : 50;
        }))) : null;
        const ride = used.length ? Math.round(mean(used.map(function (p) {
            return p.rideComfortScore != null ? p.rideComfortScore : 50;
        }))) : null;
        const pt = used.length ? Math.round(mean(used.map(function (p) {
            return p.powertrainSmoothnessScore != null ? p.powertrainSmoothnessScore : 50;
        }))) : null;

        const lowSpeed = points.filter(function (p) {
            const spd = p.filteredSpeed != null ? p.filteredSpeed : p.speed || 0;
            return spd >= 10 && spd <= 20;
        });
        const cruise = points.filter(function (p) {
            const spd = p.filteredSpeed != null ? p.filteredSpeed : p.speed || 0;
            return spd >= 30 && (p.drivingState === DRIVING_STATE.CRUISE || p.driveEvent === 'cruise');
        });
        const stopped = points.filter(function (p) {
            return p.drivingState === DRIVING_STATE.STOPPED || p.driveEvent === 'stop';
        });
        const lowShake = lowSpeed.length
            ? mean(lowSpeed.map(function (p) { return p.shakeScore != null ? p.shakeScore : (p.shake || 0); }))
            : 0;
        const cruiseShake = cruise.length
            ? mean(cruise.map(function (p) { return p.shakeScore != null ? p.shakeScore : (p.shake || 0); }))
            : 0;
        const stopVib = stopped.length
            ? mean(stopped.map(function (p) { return p.continuousVibration || 0; }))
            : 0;
        const transitions = points.filter(function (p) {
            return p.powertrainTransition && p.powertrainTransition !== POWERTRAIN_TRANSITION.NONE;
        }).length;
        const lowSpeedTrans = lowSpeed.filter(function (p) {
            return p.powertrainTransition && p.powertrainTransition !== POWERTRAIN_TRANSITION.NONE;
        }).length;
        const road = avg('roadNoiseScore') || 0;
        const wind = avg('windNoiseScore') || 0;

        const character = {
            lowSpeedShake: levelFromScore(lowShake, 0.18, 0.38),
            cruisingStability: qualityFromScore(100 - clamp(cruiseShake / 0.7 * 100, 0, 100), 72, 48),
            powertrainTransitions: freqLabel(transitions),
            roadNoise: levelFromScore(road, 28, 58),
            windNoise: levelFromScore(wind, 22, 48),
            lowSpeedPowertrain: lowSpeedTrans >= 3 || (lowSpeed.length && lowSpeedTrans / Math.max(lowSpeed.length, 1) > 0.12)
                ? 'High'
                : (lowSpeedTrans ? 'Medium' : 'Low')
        };

        const comments = [];
        if (lowSpeed.length && lowShake >= 0.28) {
            comments.push('発進から20km/h付近で車体の揺動が大きくなっています。');
        }
        if (cruise.length && cruiseShake + 0.08 < lowShake) {
            comments.push('30km/h以上ではShakeが低下し、走行状態は安定しています。');
        }
        if (lowSpeedTrans >= 2 || transitions >= 4) {
            comments.push('低速域で複数のパワートレーン状態変化を検出しました。');
        }
        if (stopped.length && stopVib < 0.08) {
            comments.push('停止中の車体振動は小さく抑えられています。');
        }
        const evMean = avg('evLikelihood') || 0;
        if (evMean >= 0.55) {
            comments.push('エンジンOFFに近い区間があり、EV走行に近い状態が推定されました。');
        }
        if (!comments.length && used.length) {
            comments.push('走行状態と車体挙動を記録しました。速度帯・イベント別の集計をCSVで確認できます。');
        }

        return {
            quietnessScore: quiet,
            rideComfortScore: ride,
            powertrainSmoothnessScore: pt,
            character: character,
            comments: comments,
            speedBands: aggregate(points, function (p) {
                return bandOfSpeed(p.filteredSpeed != null ? p.filteredSpeed : p.speed || 0);
            }),
            eventStats: aggregate(points, function (p) {
                return p.drivingState || DRIVING_STATE.UNKNOWN;
            }),
            transitionCount: transitions,
            lowSpeedTransitionCount: lowSpeedTrans
        };
    }

    function serializePoint(point) {
        const DA = A();
        const num = DA && DA.numCell
            ? function (value, digits) { return DA.numCell(value, digits); }
            : function (value, digits) {
                return typeof value === 'number' && isFinite(value) ? value.toFixed(digits) : '';
            };
        const cell = DA && DA.csvCell ? DA.csvCell : function (value) { return value == null ? '' : String(value); };
        return [
            num(point.rawSpeed, 2),
            num(point.filteredSpeed, 2),
            point.gpsValid ? 1 : 0,
            num(point.gpsConfidence, 3),
            cell(point.drivingState || ''),
            num(point.continuousVibration, 3),
            num(point.shakeScore, 3),
            num(point.impactScore, 2),
            point.impactEvent ? 1 : 0,
            num(point.longitudinalMotion, 3),
            num(point.verticalMotion, 3),
            num(point.lateralMotion, 3),
            num(point.engineProbability, 3),
            cell(point.engineState || ''),
            num(point.engineStartProbability, 3),
            num(point.engineStopProbability, 3),
            cell(point.powertrainTransition || ''),
            num(point.evLikelihood, 3),
            num(point.engineNoiseScore, 1),
            num(point.roadNoiseScore, 1),
            num(point.windNoiseScore, 1),
            num(point.audioDelta, 2),
            num(point.vibrationDelta, 3),
            point.quietnessScore == null ? '' : String(point.quietnessScore),
            point.rideComfortScore == null ? '' : String(point.rideComfortScore),
            point.powertrainSmoothnessScore == null ? '' : String(point.powertrainSmoothnessScore),
            num(point.rideVibrationScore, 1),
            num(point.rideShakeScore, 1),
            num(point.rideImpactScore, 1),
            num(point.rideStabilityScore, 1),
            cell(point.engineDebug || '')
        ];
    }

    function summaryComments(summary, character) {
        const DA = A();
        const cell = DA && DA.csvCell ? DA.csvCell : String;
        const lines = [
            `# analysis_model,legacy+vehicle_v1`,
            `# quietness_score,${summary.quietnessScore == null ? '' : summary.quietnessScore}`,
            `# ride_comfort_score,${summary.rideComfortScore == null ? '' : summary.rideComfortScore}`,
            `# powertrain_smoothness_score,${summary.powertrainSmoothnessScore == null ? '' : summary.powertrainSmoothnessScore}`
        ];
        if (character) {
            lines.push(`# low_speed_shake,${cell(character.lowSpeedShake)}`);
            lines.push(`# cruising_stability,${cell(character.cruisingStability)}`);
            lines.push(`# powertrain_transitions,${cell(character.powertrainTransitions)}`);
            lines.push(`# road_noise,${cell(character.roadNoise)}`);
            lines.push(`# wind_noise,${cell(character.windNoise)}`);
            lines.push(`# low_speed_powertrain,${cell(character.lowSpeedPowertrain)}`);
        }
        if (summary.comments && summary.comments.length) {
            summary.comments.forEach(function (text) {
                lines.push(`# comment,${cell(text)}`);
            });
        }
        if (summary.speedBands) {
            summary.speedBands.forEach(function (band) {
                lines.push(
                    `# speed_band,${band.id},n=${band.count},vibration=${band.vibration.toFixed(3)},shake=${band.shake.toFixed(3)},transitions=${band.powertrainTransition}`
                );
            });
        }
        if (summary.eventStats) {
            summary.eventStats.forEach(function (ev) {
                lines.push(
                    `# event_band,${ev.id},n=${ev.count},vibration=${ev.vibration.toFixed(3)},shake=${ev.shake.toFixed(3)},transitions=${ev.powertrainTransition}`
                );
            });
        }
        return lines;
    }

    global.DriveVehicle = {
        CONFIG: CONFIG,
        DRIVING_STATE: DRIVING_STATE,
        DRIVING_STATE_LABEL: DRIVING_STATE_LABEL,
        ENGINE_STATE: ENGINE_STATE,
        POWERTRAIN_TRANSITION: POWERTRAIN_TRANSITION,
        SPEED_BANDS: SPEED_BANDS,
        CSV_COLUMNS: CSV_COLUMNS,
        VehicleAnalyzer: VehicleAnalyzer,
        audioLayerBands: audioLayerBands,
        summarizeSession: summarizeSession,
        serializePoint: serializePoint,
        summaryComments: summaryComments,
        levelFromScore: levelFromScore
    };
})(window);
