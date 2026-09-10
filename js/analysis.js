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

    function audioBands(freqDb, sampleRate, fftSize) {
        const engine = bandDbfs(freqDb, sampleRate, fftSize, 30, 250);
        const road = bandDbfs(freqDb, sampleRate, fftSize, 250, 800);
        const wind = bandDbfs(freqDb, sampleRate, fftSize, 800, 5000);
        const pEngine = Math.pow(10, engine / 10);
        const pRoad = Math.pow(10, road / 10);
        const pWind = Math.pow(10, wind / 10);
        const total = pEngine + pRoad + pWind;
        return {
            engineDb: engine,
            roadDb: road,
            windDb: wind,
            enginePct: total > 0 ? (100 * pEngine) / total : 0,
            roadPct: total > 0 ? (100 * pRoad) / total : 0,
            windPct: total > 0 ? (100 * pWind) / total : 0
        };
    }

    // 同一端末・同一マウントでの車種比較用（0=うるさい, 100=静か）
    function quietnessScore(meanDbfs) {
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

    function noiseColor(dbfs) {
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
        const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const ss = String(totalSec % 60).padStart(2, '0');
        return `${mm}:${ss}`;
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
        quietnessScore,
        dominantFrequency,
        comfortFromVibration,
        heatColor,
        noiseColor,
        lateralColor,
        formatClock,
        formatDuration
    };
})(window);
