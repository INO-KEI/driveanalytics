// analysis.js
// 音圧帯域・振動快適性・走行距離などの計算（同一端末での相対比較向け）

(function (global) {
    const G = 9.80665;

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function hypot3(x, y, z) {
        return Math.sqrt(x * x + y * y + z * z);
    }

    function haversineMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad;
        const dLon = (lon2 - lon1) * toRad;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    function bearingDegrees(lat1, lon1, lat2, lon2) {
        const toRad = Math.PI / 180;
        const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
        const x =
            Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.cos((lon2 - lon1) * toRad);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    function wrapHeadingDelta(fromDeg, toDeg) {
        let delta = toDeg - fromDeg;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        return delta;
    }

    // GPS速度の変化から前後加速度 [m/s²]。異常値は捨てる
    function longitudinalAccel(speed0Kmh, speed1Kmh, dtSec) {
        if (!dtSec || dtSec < 0.12 || dtSec > 2.5) {
            return null;
        }
        const raw = ((speed1Kmh - speed0Kmh) / 3.6) / dtSec;
        if (!isFinite(raw)) {
            return null;
        }
        return clamp(raw, -8, 8);
    }

    // 走行軌跡の方位変化と速度からコーナリング加速度 [m/s²]
    function corneringAccel(speedMps, headingDeltaDeg, dtSec) {
        if (!dtSec || dtSec <= 0 || speedMps < 1.4) {
            return 0;
        }
        const yawRate = (headingDeltaDeg * Math.PI / 180) / dtSec;
        return speedMps * yawRate;
    }

    function dbfsFromTimeDomain(samples) {
        const n = samples.length;
        if (!n) {
            return -100;
        }
        const isByte = samples instanceof Uint8Array;
        let mean = 0;
        for (let i = 0; i < n; i++) {
            mean += isByte ? (samples[i] - 128) / 128 : samples[i];
        }
        mean /= n;
        let sumSq = 0;
        for (let i = 0; i < n; i++) {
            const v = (isByte ? (samples[i] - 128) / 128 : samples[i]) - mean;
            sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / n);
        if (rms < 1e-8) {
            return -100;
        }
        return 20 * Math.log10(rms);
    }

    // カスタネットなどの衝撃音向け（窓内の最大振幅）
    function peakDbfsFromTimeDomain(timeBytes) {
        let peak = 0;
        for (let i = 0; i < timeBytes.length; i++) {
            const v = Math.abs((timeBytes[i] - 128) / 128);
            if (v > peak) {
                peak = v;
            }
        }
        if (peak < 1e-8) {
            return -100;
        }
        return 20 * Math.log10(peak);
    }

    // 車内NVH。3分類はUI用、細帯域はCSV分析用。
    const FINE_BANDS = [
        { key: 'boom', low: 20, high: 80, group: 'engine', label: '低周波' },
        { key: 'power', low: 80, high: 250, group: 'engine', label: 'エンジン' },
        { key: 'struct', low: 250, high: 500, group: 'road', label: '路面低' },
        { key: 'tire', low: 500, high: 1600, group: 'road', label: 'ロード' },
        { key: 'cabin', low: 1600, high: 3500, group: 'wind', label: '中高' },
        { key: 'aero', low: 3500, high: 8000, group: 'wind', label: '風切' }
    ];

    const NOISE_BANDS = {
        engine: { low: 20, high: 250, label: 'エンジン' },
        road: { low: 250, high: 1600, label: 'ロードノイズ' },
        wind: { low: 1600, high: 8000, label: '風切り音' }
    };

    const NOISE_DOMINANT_LABEL = {
        engine: 'エンジン',
        road: 'ロードノイズ',
        wind: '風切り音',
        boom: '低周波',
        power: 'エンジン',
        struct: '路面低',
        tire: 'ロード',
        cabin: '中高',
        aero: '風切',
        none: '--'
    };

    const DRIVE_MODES = [
        { id: 'unset', label: '未設定' },
        { id: 'eco', label: 'Eco' },
        { id: 'normal', label: 'Normal' },
        { id: 'sport', label: 'Sport' }
    ];

    const DRIVE_EVENT_LABEL = {
        stop: '停止',
        launch: '発進',
        cruise: '定常',
        accel: '加速',
        brake: '減速',
        none: '--'
    };

    function bandBinRange(sampleRate, fftSize, freqCount, fLow, fHigh) {
        const binHz = sampleRate / fftSize;
        const i0 = Math.max(1, Math.round(fLow / binHz));
        const i1 = Math.min(freqCount, Math.round(fHigh / binHz));
        return { i0: i0, i1: Math.max(i0, i1) };
    }

    function bandIntegratedPower(freqDb, sampleRate, fftSize, fLow, fHigh) {
        const range = bandBinRange(sampleRate, fftSize, freqDb.length, fLow, fHigh);
        let power = 0;
        for (let i = range.i0; i < range.i1; i++) {
            const db = freqDb[i];
            if (!isFinite(db)) {
                continue;
            }
            power += Math.pow(10, db / 10);
        }
        return power;
    }

    function bandPower(freqDb, sampleRate, fftSize, fLow, fHigh) {
        const range = bandBinRange(sampleRate, fftSize, freqDb.length, fLow, fHigh);
        let power = 0;
        let count = 0;
        for (let i = range.i0; i < range.i1; i++) {
            const db = freqDb[i];
            if (!isFinite(db)) {
                continue;
            }
            power += Math.pow(10, db / 10);
            count++;
        }
        return count ? power / count : 0;
    }

    function emptyBandSplit() {
        const out = {
            engineDb: -100,
            roadDb: -100,
            windDb: -100,
            engineShare: 0,
            roadShare: 0,
            windShare: 0,
            dominant: 'none',
            dominantFine: 'none'
        };
        FINE_BANDS.forEach(function (band) {
            out[band.key + 'Db'] = -100;
            out[band.key + 'Share'] = 0;
        });
        return out;
    }

    function splitFromPowers(overallDbfs, powers) {
        const keys = Object.keys(powers);
        let total = 0;
        keys.forEach(function (key) {
            total += Math.max(0, powers[key] || 0);
        });
        const out = {};
        if (!(total > 0) || !isFinite(overallDbfs)) {
            keys.forEach(function (key) {
                out[key + 'Db'] = -100;
                out[key + 'Share'] = 0;
            });
            out.dominant = 'none';
            return out;
        }
        let best = keys[0];
        keys.forEach(function (key) {
            const share = powers[key] / total;
            out[key + 'Share'] = share;
            out[key + 'Db'] = overallDbfs + 10 * Math.log10(Math.max(share, 1e-12));
            if ((powers[key] || 0) > (powers[best] || 0)) {
                best = key;
            }
        });
        out.dominant = best;
        return out;
    }

    function bandsFromFinePowers(overallDbfs, finePowers) {
        const groupPowers = { engine: 0, road: 0, wind: 0 };
        FINE_BANDS.forEach(function (band) {
            groupPowers[band.group] += Math.max(0, finePowers[band.key] || 0);
        });
        const grouped = splitFromPowers(overallDbfs, groupPowers);
        const fine = splitFromPowers(overallDbfs, finePowers);
        const merged = emptyBandSplit();
        Object.assign(merged, fine, grouped);
        merged.dominantFine = fine.dominant;
        return merged;
    }

    // 全体の音圧をFFT帯域の積分パワー比で按分する
    function splitOverallDbfs(overallDbfs, engineP, roadP, windP) {
        return bandsFromFinePowers(overallDbfs, {
            boom: (engineP || 0) * 0.45,
            power: (engineP || 0) * 0.55,
            struct: (roadP || 0) * 0.35,
            tire: (roadP || 0) * 0.65,
            cabin: (windP || 0) * 0.4,
            aero: (windP || 0) * 0.6
        });
    }

    function audioBands(freqDb, sampleRate, fftSize, overallDbfs) {
        const finePowers = {};
        FINE_BANDS.forEach(function (band) {
            finePowers[band.key] = bandIntegratedPower(
                freqDb, sampleRate, fftSize, band.low, band.high
            );
        });
        return bandsFromFinePowers(overallDbfs, finePowers);
    }

    function axisStats(samples) {
        const n = samples.length;
        if (!n) {
            return { mean: 0, rms: 0, peak: 0, std: 0 };
        }
        let sum = 0;
        let sumSq = 0;
        let peak = 0;
        for (let i = 0; i < n; i++) {
            const v = samples[i];
            sum += v;
            sumSq += v * v;
            peak = Math.max(peak, Math.abs(v));
        }
        const mean = sum / n;
        let varSum = 0;
        for (let i = 0; i < n; i++) {
            const d = samples[i] - mean;
            varSum += d * d;
        }
        return {
            mean: mean,
            rms: Math.sqrt(sumSq / n),
            peak: peak,
            std: Math.sqrt(varSum / n)
        };
    }

    function classifyDriveEvent(speedKmh, accelMps2, trace, prev) {
        const speed = speedKmh || 0;
        const accel = accelMps2 || 0;
        const recent = (trace || []).slice(-4);
        const meanSpeed = recent.length
            ? recent.reduce(function (sum, point) { return sum + (point.speed || 0); }, 0) / recent.length
            : speed;
        let speedStd = 0;
        if (recent.length >= 3) {
            let varSum = 0;
            recent.forEach(function (point) {
                const d = (point.speed || 0) - meanSpeed;
                varSum += d * d;
            });
            speedStd = Math.sqrt(varSum / recent.length);
        }

        if (speed < 2.5 && meanSpeed < 4) {
            return 'stop';
        }
        if (prev === 'launch' && speed >= 3 && speed < 40 && accel > 0.08) {
            return 'launch';
        }
        if ((prev === 'stop' || prev === 'launch') && speed >= 3 && speed < 40 && accel > 0.12) {
            return 'launch';
        }
        if (speed >= 22 && Math.abs(accel) < 0.45 && speedStd < 4) {
            return 'cruise';
        }
        if (accel >= 0.55) {
            return 'accel';
        }
        if (accel <= -0.6) {
            return 'brake';
        }
        if (speed < 5) {
            return 'stop';
        }
        if (prev && prev !== 'none') {
            return prev;
        }
        return speed >= 22 ? 'cruise' : 'accel';
    }

    function pickDriveEvent(current, trace, since) {
        const event = current || 'none';
        if (event === 'stop') {
            return 'stop';
        }
        let hadStop = false;
        let hadLaunch = false;
        (trace || []).forEach(function (item) {
            if (item.t < since) {
                return;
            }
            if (item.event === 'stop') {
                hadStop = true;
            }
            if (item.event === 'launch') {
                hadLaunch = true;
            }
        });
        if (hadStop && hadLaunch) {
            return 'launch';
        }
        return event;
    }

    // ナビ音声・会話らしい区間。完全除去ではなく除外判定用
    function speechLikelihood(freqDb, sampleRate, fftSize, midHistory) {
        const speech = bandPower(freqDb, sampleRate, fftSize, 300, 3400);
        const low = bandPower(freqDb, sampleRate, fftSize, 30, 250);
        const high = bandPower(freqDb, sampleRate, fftSize, 4000, 8000);
        const total = speech + low + high + 1e-12;
        const speechRatio = speech / total;

        let modulation = 0;
        if (midHistory && midHistory.length >= 8) {
            let mean = 0;
            for (let i = 0; i < midHistory.length; i++) {
                mean += midHistory[i];
            }
            mean /= midHistory.length;
            let variance = 0;
            for (let i = 0; i < midHistory.length; i++) {
                const d = midHistory[i] - mean;
                variance += d * d;
            }
            variance /= midHistory.length;
            modulation = mean > 1e-12 ? Math.sqrt(variance) / mean : 0;
        }

        let score = 0;
        if (speechRatio > 0.42) {
            score += 0.4;
        }
        if (speechRatio > 0.58) {
            score += 0.2;
        }
        if (modulation > 0.22) {
            score += 0.3;
        }
        if (modulation > 0.38) {
            score += 0.15;
        }
        return {
            score: clamp(score, 0, 1),
            speechRatio: speechRatio,
            modulation: modulation,
            speechPower: speech
        };
    }

    // 未校正: 端末の相対dBFS。校正済: カスタネット基準からの差（0に近いほど大きい）
    function quietnessScore(meanDbfs, calibrated) {
        if (calibrated) {
            return Math.round(clamp(((-meanDbfs - 8) / 32) * 100, 0, 100));
        }
        return Math.round(clamp(((-meanDbfs - 12) / 38) * 100, 0, 100));
    }

    function dominantFrequency(samples, sampleRate) {
        const n = samples.length;
        if (n < 4 || !sampleRate) {
            return { rms: 0, peak: 0, peakToPeak: 0, freq: 0 };
        }

        let mean = 0;
        for (let i = 0; i < n; i++) {
            mean += samples[i];
        }
        mean /= n;

        const centered = new Array(n);
        let sumSq = 0;
        let peak = 0;
        for (let i = 0; i < n; i++) {
            const v = samples[i] - mean;
            centered[i] = v;
            sumSq += v * v;
            peak = Math.max(peak, Math.abs(v));
        }
        const rms = Math.sqrt(sumSq / n);

        let bestMag = 0;
        let bestK = 1;
        const kMax = Math.floor(n / 2);
        for (let k = 1; k < kMax; k++) {
            let re = 0;
            let im = 0;
            const w = 2 * Math.PI * k / n;
            for (let t = 0; t < n; t++) {
                re += centered[t] * Math.cos(w * t);
                im -= centered[t] * Math.sin(w * t);
            }
            const mag = Math.hypot(re, im);
            if (mag > bestMag) {
                bestMag = mag;
                bestK = k;
            }
        }

        return {
            rms: rms,
            peak: peak,
            peakToPeak: peak * 2,
            freq: bestK * sampleRate / n
        };
    }

    // 上下RMSと水平面RMSの合成（二乗和平方根）。エンジン・路面の3軸揺れを1つの大きさにする
    function combineVibrationRms(vertRms, horizRms) {
        const v = vertRms || 0;
        const h = horizRms || 0;
        return Math.sqrt(v * v + h * h);
    }

    // 振幅グラフの固定縮尺 [m/s²]。ISO 2631-1 の「極めて不快」(1.6) が上部に来る
    const VIB_CHART = {
        yMax: 3.0,
        hzMax: 25,
        droneHigh: 0.32,
        impactHigh: 0.8
    };

    const VIB_KIND_LABEL = {
        drone: 'エンジン・路面',
        rough: '強い路面',
        impact: '乗り上げ',
        none: '--'
    };

    const VIB_KIND_COLOR = {
        drone: '#ffd200',
        rough: '#ff7a18',
        impact: '#ff3b30',
        none: '#8a6a45'
    };

    // 振れ幅（片振幅）とRMSの比で、持続振動と衝撃を分ける
    function classifyVibration(vertRms, peakToPeak) {
        const rms = vertRms || 0;
        const peakAmp = (peakToPeak || 0) / 2;
        const crest = rms > 0.05 ? peakAmp / rms : 0;

        if (peakAmp >= 0.9 || (crest >= 3 && peakAmp >= 0.5)) {
            return { kind: 'impact', label: VIB_KIND_LABEL.impact, className: 'vib-impact' };
        }
        if (rms < VIB_CHART.droneHigh && peakAmp < 0.7) {
            return { kind: 'drone', label: VIB_KIND_LABEL.drone, className: 'vib-drone' };
        }
        return { kind: 'rough', label: VIB_KIND_LABEL.rough, className: 'vib-rough' };
    }

    // 車内スマホ向け。ISO 2631-1 より閾値を緩くし、短時間の突起で判定が跳ねないようにする
    function comfortFromVibration(rms) {
        const weighted = rms || 0;
        let label = '快適';
        let className = 'comfort-good';
        if (weighted >= 2.4) {
            label = '極めて不快';
            className = 'comfort-extreme';
        } else if (weighted >= 1.6) {
            label = 'かなり不快';
            className = 'comfort-bad';
        } else if (weighted >= 1.05) {
            label = '不快';
            className = 'comfort-bad';
        } else if (weighted >= 0.55) {
            label = 'やや不快';
            className = 'comfort-mid';
        }

        return { label, className, weighted };
    }

    function heatColor(t) {
        const x = clamp(t, 0, 1);
        const r = Math.round(255 * Math.min(1, x * 2));
        const g = Math.round(255 * Math.min(1, 2 - x * 2));
        return `rgb(${r},${g},48)`;
    }

    function noiseColor(dbfs, calibrated) {
        if (calibrated) {
            return heatColor((dbfs + 36) / 36);
        }
        return heatColor((dbfs + 48) / 36);
    }

    function lateralColor(shakeMps2) {
        return heatColor(shakeMps2 / 1.6);
    }

    function vibrationColor(combinedRms) {
        return heatColor((combinedRms || 0) / 1.2);
    }

    function formatClock(date) {
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }

    function formatDuration(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const hh = Math.floor(totalSec / 3600);
        const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
        const ss = String(totalSec % 60).padStart(2, '0');
        return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    function formatStamp(date) {
        const y = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return `${y}${mo}${d}-${hh}${mm}${ss}`;
    }

    function csvCell(value) {
        if (value == null || value === '') {
            return '';
        }
        const text = String(value);
        if (/[",\r\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }

    function numCell(value, digits) {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return '';
        }
        return value.toFixed(digits);
    }

    function buildTrackCsv(summary, points) {
        const fineKeys = [];
        FINE_BANDS.forEach(function (band) {
            fineKeys.push(band.key + '_db', band.key + '_share');
        });
        const V = global.DriveVehicle;
        const lines = [
            '# DriveAnalytics',
            `# started_at,${summary.startedAt ? new Date(summary.startedAt).toISOString() : ''}`,
            `# duration,${formatDuration(summary.elapsedMs || 0)}`,
            `# distance_km,${numCell((summary.distanceM || 0) / 1000, 3)}`,
            `# average_speed_kmh,${numCell(summary.averageSpeed || 0, 2)}`,
            `# quietness,${summary.quietness == null ? '' : summary.quietness}`,
            `# drive_mode,${summary.driveMode || ''}`,
            '# noise_bands,boom 20-80Hz,power 80-250Hz,struct 250-500Hz,tire 500-1600Hz,cabin 1600-3500Hz,aero 3500-8000Hz',
            '# analysis_note,legacy shares kept for comparison; new model uses independent scores and driving/powertrain layers',
            `# points,${points.length}`
        ];
        if (V && V.summaryComments) {
            lines.push.apply(lines, V.summaryComments(summary, summary.character));
        }
        const vehicleKeys = (V && V.CSV_COLUMNS) || [];
        lines.push([
            'index',
            'time_local',
            'time_iso',
            'elapsed_s',
            'latitude',
            'longitude',
            'speed_kmh',
            'avg_speed_kmh',
            'distance_m',
            'drive_mode',
            'drive_event',
            'rms_ms2',
            'shake_ms2',
            'combined_rms_ms2',
            'x_rms',
            'y_rms',
            'z_rms',
            'x_peak',
            'y_peak',
            'z_peak',
            'x_std',
            'y_std',
            'z_std',
            'vert_peak',
            'lateral_g',
            'freq_hz',
            'comfort',
            'spl_db',
            'quietness',
            'engine_db',
            'road_db',
            'wind_db',
            'engine_share',
            'road_share',
            'wind_share',
            'legacy_engine_share',
            'legacy_road_share',
            'legacy_wind_share',
            'dominant_noise',
            'dominant_fine'
        ].concat(fineKeys).concat([
            'voice',
            'calibrated'
        ]).concat(vehicleKeys).join(','));
        points.forEach((point) => {
            const when = new Date(point.time);
            const fineVals = [];
            FINE_BANDS.forEach(function (band) {
                fineVals.push(numCell(point[band.key + 'Db'], 2), numCell(point[band.key + 'Share'], 3));
            });
            lines.push([
                point.index,
                csvCell(formatClock(when)),
                csvCell(when.toISOString()),
                numCell((point.elapsedMs || 0) / 1000, 0),
                numCell(point.latitude, 6),
                numCell(point.longitude, 6),
                numCell(point.filteredSpeed != null ? point.filteredSpeed : point.speed, 2),
                numCell(point.avgSpeed, 2),
                numCell(point.distanceM, 1),
                csvCell(point.driveMode || ''),
                csvCell(point.driveEvent || ''),
                numCell(point.rms, 3),
                numCell(point.shake, 3),
                numCell(point.combinedRms, 3),
                numCell(point.xRms, 3),
                numCell(point.yRms, 3),
                numCell(point.zRms, 3),
                numCell(point.xPeak, 3),
                numCell(point.yPeak, 3),
                numCell(point.zPeak, 3),
                numCell(point.xStd, 3),
                numCell(point.yStd, 3),
                numCell(point.zStd, 3),
                numCell(point.peak, 3),
                numCell(point.lateralG, 3),
                numCell(point.freq, 2),
                csvCell(point.voice ? '音声除外' : (point.comfort || '')),
                numCell(point.dbfs, 2),
                point.quietness == null ? '' : point.quietness,
                numCell(point.engineDb, 2),
                numCell(point.roadDb, 2),
                numCell(point.windDb, 2),
                numCell(point.engineShare, 3),
                numCell(point.roadShare, 3),
                numCell(point.windShare, 3),
                numCell(point.engineShare, 3),
                numCell(point.roadShare, 3),
                numCell(point.windShare, 3),
                csvCell(point.dominant || ''),
                csvCell(point.dominantFine || '')
            ].concat(fineVals).concat([
                point.voice ? 1 : 0,
                point.calibrated ? 1 : 0
            ]).concat(V && V.serializePoint ? V.serializePoint(point) : []).join(','));
        });
        return lines.join('\r\n');
    }

    global.DriveAnalysis = {
        G,
        clamp,
        hypot3,
        haversineMeters,
        bearingDegrees,
        wrapHeadingDelta,
        longitudinalAccel,
        corneringAccel,
        dbfsFromTimeDomain,
        FINE_BANDS,
        NOISE_BANDS,
        NOISE_DOMINANT_LABEL,
        DRIVE_MODES,
        DRIVE_EVENT_LABEL,
        bandBinRange,
        bandIntegratedPower,
        bandPower,
        audioBands,
        splitOverallDbfs,
        bandsFromFinePowers,
        axisStats,
        classifyDriveEvent,
        pickDriveEvent,
        speechLikelihood,
        quietnessScore,
        dominantFrequency,
        combineVibrationRms,
        VIB_CHART,
        VIB_KIND_LABEL,
        VIB_KIND_COLOR,
        classifyVibration,
        comfortFromVibration,
        heatColor,
        noiseColor,
        lateralColor,
        vibrationColor,
        formatClock,
        formatDuration,
        formatStamp,
        csvCell,
        numCell,
        buildTrackCsv
    };
})(window);
