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

    function dbfsFromTimeDomain(timeBytes) {
        let sumSq = 0;
        for (let i = 0; i < timeBytes.length; i++) {
            const v = (timeBytes[i] - 128) / 128;
            sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / timeBytes.length);
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

    // 車内NVHの一次近似。帯域は重なるので完全分離ではなく目安。
    const NOISE_BANDS = {
        engine: { low: 20, high: 400, label: 'エンジン' },
        road: { low: 400, high: 1600, label: 'ロードノイズ' },
        wind: { low: 1600, high: 8000, label: '風切り音' }
    };

    const NOISE_DOMINANT_LABEL = {
        engine: 'エンジン',
        road: 'ロードノイズ',
        wind: '風切り音',
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
        return {
            engineDb: -100,
            roadDb: -100,
            windDb: -100,
            engineShare: 0,
            roadShare: 0,
            windShare: 0,
            dominant: 'none'
        };
    }

    // 全体の音圧を、FFT帯域の積分パワー比でエンジン／ロード／風切に按分する
    function splitOverallDbfs(overallDbfs, engineP, roadP, windP) {
        const total = engineP + roadP + windP;
        if (!(total > 0) || !isFinite(overallDbfs)) {
            return emptyBandSplit();
        }
        const engineShare = engineP / total;
        const roadShare = roadP / total;
        const windShare = windP / total;
        const toDb = function (share) {
            return overallDbfs + 10 * Math.log10(Math.max(share, 1e-12));
        };
        let dominant = 'engine';
        if (roadP >= engineP && roadP >= windP) {
            dominant = 'road';
        } else if (windP >= engineP && windP >= roadP) {
            dominant = 'wind';
        }
        return {
            engineDb: toDb(engineShare),
            roadDb: toDb(roadShare),
            windDb: toDb(windShare),
            engineShare: engineShare,
            roadShare: roadShare,
            windShare: windShare,
            dominant: dominant
        };
    }

    function audioBands(freqDb, sampleRate, fftSize, overallDbfs) {
        const engineP = bandIntegratedPower(freqDb, sampleRate, fftSize, NOISE_BANDS.engine.low, NOISE_BANDS.engine.high);
        const roadP = bandIntegratedPower(freqDb, sampleRate, fftSize, NOISE_BANDS.road.low, NOISE_BANDS.road.high);
        const windP = bandIntegratedPower(freqDb, sampleRate, fftSize, NOISE_BANDS.wind.low, NOISE_BANDS.wind.high);
        return splitOverallDbfs(overallDbfs, engineP, roadP, windP);
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
        yMax: 2.0,
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

    // ISO 2631-1 の快適区分を簡易適用（車内スマホは目安）
    function comfortFromVibration(rms, freqHz) {
        let weighted = rms;
        if (freqHz >= 4 && freqHz <= 8) {
            weighted *= 1.4;
        } else if (freqHz >= 1 && freqHz < 4) {
            weighted *= 1.15;
        }

        let label = '快適';
        let className = 'comfort-good';
        if (weighted >= 1.6) {
            label = '極めて不快';
            className = 'comfort-extreme';
        } else if (weighted >= 1.0) {
            label = 'かなり不快';
            className = 'comfort-bad';
        } else if (weighted >= 0.63) {
            label = '不快';
            className = 'comfort-bad';
        } else if (weighted >= 0.315) {
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
        const lines = [
            '# DriveAnalytics',
            `# started_at,${summary.startedAt ? new Date(summary.startedAt).toISOString() : ''}`,
            `# duration,${formatDuration(summary.elapsedMs || 0)}`,
            `# distance_km,${numCell((summary.distanceM || 0) / 1000, 3)}`,
            `# average_speed_kmh,${numCell(summary.averageSpeed || 0, 2)}`,
            `# quietness,${summary.quietness == null ? '' : summary.quietness}`,
            '# noise_bands,engine 20-400Hz,road 400-1600Hz,wind 1600-8000Hz',
            `# points,${points.length}`,
            [
                'index',
                'time_local',
                'time_iso',
                'elapsed_s',
                'latitude',
                'longitude',
                'speed_kmh',
                'avg_speed_kmh',
                'distance_m',
                'rms_ms2',
                'shake_ms2',
                'combined_rms_ms2',
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
                'dominant_noise',
                'voice',
                'calibrated'
            ].join(',')
        ];
        points.forEach((point) => {
            const when = new Date(point.time);
            lines.push([
                point.index,
                csvCell(formatClock(when)),
                csvCell(when.toISOString()),
                numCell((point.elapsedMs || 0) / 1000, 0),
                numCell(point.latitude, 6),
                numCell(point.longitude, 6),
                numCell(point.speed, 2),
                numCell(point.avgSpeed, 2),
                numCell(point.distanceM, 1),
                numCell(point.rms, 3),
                numCell(point.shake, 3),
                numCell(point.combinedRms, 3),
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
                csvCell(point.dominant || ''),
                point.voice ? 1 : 0,
                point.calibrated ? 1 : 0
            ].join(','));
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
        NOISE_BANDS,
        NOISE_DOMINANT_LABEL,
        audioBands,
        splitOverallDbfs,
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
        buildTrackCsv
    };
})(window);
