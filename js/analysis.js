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

    // FFTビンから帯域の平均パワーを dBFS 相当で返す
    function bandDbfs(freqDb, sampleRate, fftSize, fLow, fHigh) {
        const binHz = sampleRate / fftSize;
        const i0 = Math.max(1, Math.floor(fLow / binHz));
        const i1 = Math.min(freqDb.length - 1, Math.ceil(fHigh / binHz));
        let power = 0;
        let count = 0;
        for (let i = i0; i <= i1; i++) {
            power += Math.pow(10, freqDb[i] / 10);
            count++;
        }
        if (!count || power <= 0) {
            return -100;
        }
        return 10 * Math.log10(power / count);
    }

    function bandPower(freqDb, sampleRate, fftSize, fLow, fHigh) {
        const binHz = sampleRate / fftSize;
        const i0 = Math.max(1, Math.floor(fLow / binHz));
        const i1 = Math.min(freqDb.length - 1, Math.ceil(fHigh / binHz));
        let power = 0;
        let count = 0;
        for (let i = i0; i <= i1; i++) {
            const db = freqDb[i];
            if (!isFinite(db)) {
                continue;
            }
            power += Math.pow(10, db / 10);
            count++;
        }
        return count ? power / count : 0;
    }

    function audioBands(freqDb, sampleRate, fftSize) {
        const engine = bandDbfs(freqDb, sampleRate, fftSize, 30, 250);
        const road = bandDbfs(freqDb, sampleRate, fftSize, 250, 800);
        const wind = bandDbfs(freqDb, sampleRate, fftSize, 800, 5000);
        return {
            engineDb: engine,
            roadDb: road,
            windDb: wind
        };
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
        corneringAccel,
        dbfsFromTimeDomain,
        audioBands,
        speechLikelihood,
        quietnessScore,
        dominantFrequency,
        combineVibrationRms,
        comfortFromVibration,
        heatColor,
        noiseColor,
        lateralColor,
        formatClock,
        formatDuration,
        formatStamp,
        csvCell,
        buildTrackCsv
    };
})(window);
