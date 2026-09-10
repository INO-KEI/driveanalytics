// sensors.js
class SensorManager {
    constructor() {
        const A = window.DriveAnalysis;

        this.isRecording = false;
        this.locationData = {
            latitude: null,
            longitude: null,
            speed: 0,
            heading: null,
            accuracy: null
        };
        this.accelerationData = {
            x: 0,
            y: 0,
            z: 0,
            vertical: 0,
            horizontal: 0,
            rms: 0,
            peak: 0,
            freq: 0,
            comfort: '計測待機',
            comfortClass: '',
            lateralG: 0,
            shake: 0
        };
        this.noiseData = {
            dbfs: -100,
            quietness: null,
            engineDb: -100,
            roadDb: -100,
            windDb: -100,
            enginePct: 0,
            roadPct: 0,
            windPct: 0
        };

        this.locationWatchId = null;
        this.audioContext = null;
        this.analyzer = null;
        this.microphone = null;
        this.mediaStream = null;
        this.freqBuffer = null;
        this.timeBuffer = null;
        this.noiseRafId = null;
        this.sampleTimer = null;
        this.demoTimer = null;

        this.boundMotionHandler = this.handleMotionEvent.bind(this);
        this.boundLocationUpdate = this.handleLocationUpdate.bind(this);
        this.boundLocationError = this.handleLocationError.bind(this);
        this.boundNoiseFrame = this.processNoiseData.bind(this);

        this.gravity = { x: 0, y: 0, z: 9.8 };
        this.gravityReady = false;
        this.vertSamples = [];
        this.horizSamples = [];
        this.motionTimes = [];
        this.lastUiNotify = { acceleration: 0, noise: 0 };

        this.sampleTimer = null;
        this.session = this.createEmptySession();
        this.dataListeners = [];
        this.A = A;
    }

    createEmptySession() {
        return {
            startedAt: null,
            points: [],
            distanceM: 0,
            movingDbfsSum: 0,
            movingDbfsCount: 0,
            lastFix: null
        };
    }

    startLocationTracking() {
        if (!navigator.geolocation) {
            this.notifyListeners('error', { message: 'このブラウザは位置情報に対応していません。' });
            return;
        }

        this.locationWatchId = navigator.geolocation.watchPosition(
            this.boundLocationUpdate,
            this.boundLocationError,
            {
                enableHighAccuracy: true,
                timeout: 8000,
                maximumAge: 0
            }
        );
    }

    handleLocationUpdate(position) {
        const coords = position.coords;
        const speedKmh = coords.speed != null && coords.speed >= 0
            ? coords.speed * 3.6
            : this.estimateSpeedKmh(coords.latitude, coords.longitude, position.timestamp);

        let heading = coords.heading;
        if ((heading == null || Number.isNaN(heading)) && this.session.lastFix) {
            heading = this.A.bearingDegrees(
                this.session.lastFix.latitude,
                this.session.lastFix.longitude,
                coords.latitude,
                coords.longitude
            );
        }

        this.locationData.latitude = coords.latitude;
        this.locationData.longitude = coords.longitude;
        this.locationData.speed = speedKmh || 0;
        this.locationData.heading = heading;
        this.locationData.accuracy = coords.accuracy;
        this.locationData.timestamp = position.timestamp;

        if (this.isRecording && this.session.lastFix) {
            const dt = (position.timestamp - this.session.lastFix.timestamp) / 1000;
            const dist = this.A.haversineMeters(
                this.session.lastFix.latitude,
                this.session.lastFix.longitude,
                coords.latitude,
                coords.longitude
            );
            if (dt > 0 && dist < 80) {
                this.session.distanceM += dist;
            }

            const headingDelta = (this.session.lastFix.heading != null && heading != null)
                ? this.A.wrapHeadingDelta(this.session.lastFix.heading, heading)
                : 0;
            const speedMps = (speedKmh || 0) / 3.6;
            this.accelerationData.lateralG = this.A.corneringAccel(speedMps, headingDelta, dt) / this.A.G;
        }

        this.session.lastFix = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            heading: heading,
            timestamp: position.timestamp,
            speedKmh: speedKmh || 0
        };

        this.notifyListeners('location', this.getLocationSnapshot());
    }

    estimateSpeedKmh(lat, lng, timestamp) {
        if (!this.session.lastFix) {
            return 0;
        }
        const dt = (timestamp - this.session.lastFix.timestamp) / 1000;
        if (dt <= 0) {
            return this.locationData.speed || 0;
        }
        const dist = this.A.haversineMeters(
            this.session.lastFix.latitude,
            this.session.lastFix.longitude,
            lat,
            lng
        );
        return (dist / dt) * 3.6;
    }

    handleLocationError(error) {
        this.notifyListeners('error', { message: '位置情報を取得できません: ' + error.message });
    }

    stopLocationTracking() {
        if (this.locationWatchId !== null) {
            navigator.geolocation.clearWatch(this.locationWatchId);
            this.locationWatchId = null;
        }
    }

    async startAccelerationTracking() {
        if (!window.DeviceMotionEvent) {
            this.notifyListeners('error', { message: 'このブラウザは加速度センサーに対応していません。' });
            return;
        }

        try {
            if (typeof DeviceMotionEvent.requestPermission === 'function') {
                const permissionState = await DeviceMotionEvent.requestPermission();
                if (!this.isRecording) {
                    return;
                }
                if (permissionState !== 'granted') {
                    this.notifyListeners('error', { message: '加速度センサーの許可が拒否されました。' });
                    return;
                }
            }
            if (!this.isRecording) {
                return;
            }
            window.addEventListener('devicemotion', this.boundMotionHandler);
        } catch (error) {
            this.notifyListeners('error', { message: '加速度センサーを開始できません。' });
            console.error(error);
        }
    }

    handleMotionEvent(event) {
        if (!this.isRecording) {
            return;
        }

        const includingGravity = event.accelerationIncludingGravity;
        const linearEvent = event.acceleration;
        if (!includingGravity && !linearEvent) {
            return;
        }

        const gx = includingGravity ? (includingGravity.x || 0) : 0;
        const gy = includingGravity ? (includingGravity.y || 0) : 0;
        const gz = includingGravity ? (includingGravity.z || 0) : 0;

        if (includingGravity) {
            if (!this.gravityReady) {
                this.gravity = { x: gx, y: gy, z: gz };
                this.gravityReady = true;
            } else {
                const alpha = 0.92;
                this.gravity.x = alpha * this.gravity.x + (1 - alpha) * gx;
                this.gravity.y = alpha * this.gravity.y + (1 - alpha) * gy;
                this.gravity.z = alpha * this.gravity.z + (1 - alpha) * gz;
            }
        }

        let linX;
        let linY;
        let linZ;
        if (linearEvent && (linearEvent.x != null || linearEvent.y != null || linearEvent.z != null)) {
            linX = linearEvent.x || 0;
            linY = linearEvent.y || 0;
            linZ = linearEvent.z || 0;
        } else {
            linX = gx - this.gravity.x;
            linY = gy - this.gravity.y;
            linZ = gz - this.gravity.z;
        }

        const gMag = this.A.hypot3(this.gravity.x, this.gravity.y, this.gravity.z) || 1;
        const gHatX = this.gravity.x / gMag;
        const gHatY = this.gravity.y / gMag;
        const gHatZ = this.gravity.z / gMag;
        const vertical = linX * gHatX + linY * gHatY + linZ * gHatZ;
        const hx = linX - vertical * gHatX;
        const hy = linY - vertical * gHatY;
        const hz = linZ - vertical * gHatZ;
        const horizontal = this.A.hypot3(hx, hy, hz);

        const now = performance.now();
        this.vertSamples.push(vertical);
        this.horizSamples.push(horizontal);
        this.motionTimes.push(now);
        while (this.motionTimes.length && now - this.motionTimes[0] > 1200) {
            this.motionTimes.shift();
            this.vertSamples.shift();
            this.horizSamples.shift();
        }

        let sampleRate = 50;
        if (this.motionTimes.length > 4) {
            const span = (this.motionTimes[this.motionTimes.length - 1] - this.motionTimes[0]) / 1000;
            sampleRate = span > 0 ? (this.motionTimes.length - 1) / span : 50;
        }

        const vib = this.A.dominantFrequency(this.vertSamples, sampleRate);
        const shakeRms = this.rms(this.horizSamples);
        const comfort = this.A.comfortFromVibration(vib.rms, vib.freq);

        this.accelerationData = {
            x: linX,
            y: linY,
            z: linZ,
            vertical: vertical,
            horizontal: horizontal,
            rms: vib.rms,
            peak: vib.peakToPeak || 0,
            freq: vib.freq || 0,
            comfort: comfort.label,
            comfortClass: comfort.className,
            lateralG: this.accelerationData.lateralG,
            shake: shakeRms,
            unavailable: false
        };

        if (now - this.lastUiNotify.acceleration > 200) {
            this.lastUiNotify.acceleration = now;
            this.notifyListeners('acceleration', Object.assign({}, this.accelerationData));
        }
    }

    rms(values) {
        if (!values.length) {
            return 0;
        }
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            sum += values[i] * values[i];
        }
        return Math.sqrt(sum / values.length);
    }

    stopAccelerationTracking() {
        window.removeEventListener('devicemotion', this.boundMotionHandler);
    }

    async startNoiseTracking() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('getUserMedia is not supported by this browser.');
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                },
                video: false
            });

            if (!this.isRecording) {
                stream.getTracks().forEach(function (track) {
                    track.stop();
                });
                return;
            }

            this.mediaStream = stream;
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.analyzer = this.audioContext.createAnalyser();
            this.analyzer.fftSize = 2048;
            this.analyzer.smoothingTimeConstant = 0.7;
            this.freqBuffer = new Float32Array(this.analyzer.frequencyBinCount);
            this.timeBuffer = new Uint8Array(this.analyzer.fftSize);
            this.microphone = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.microphone.connect(this.analyzer);
            this.processNoiseData();
        } catch (error) {
            this.notifyListeners('error', { message: 'マイクにアクセスできません。' });
            console.error('Error accessing microphone:', error);
        }
    }

    processNoiseData() {
        if (!this.isRecording || !this.analyzer) {
            this.noiseRafId = null;
            return;
        }

        this.analyzer.getFloatFrequencyData(this.freqBuffer);
        this.analyzer.getByteTimeDomainData(this.timeBuffer);

        const dbfs = this.A.dbfsFromTimeDomain(this.timeBuffer);
        const bands = this.A.audioBands(
            this.freqBuffer,
            this.audioContext.sampleRate,
            this.analyzer.fftSize
        );

        this.noiseData = {
            dbfs: dbfs,
            quietness: this.getQuietness(),
            engineDb: bands.engineDb,
            roadDb: bands.roadDb,
            windDb: bands.windDb,
            enginePct: bands.enginePct,
            roadPct: bands.roadPct,
            windPct: bands.windPct
        };

        const now = performance.now();
        if (now - this.lastUiNotify.noise > 200) {
            this.lastUiNotify.noise = now;
            this.notifyListeners('noise', Object.assign({}, this.noiseData));
        }

        this.noiseRafId = requestAnimationFrame(this.boundNoiseFrame);
    }

    stopNoiseTracking() {
        if (this.noiseRafId != null) {
            cancelAnimationFrame(this.noiseRafId);
            this.noiseRafId = null;
        }
        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(function (track) {
                track.stop();
            });
            this.mediaStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.analyzer = null;
        this.freqBuffer = null;
        this.timeBuffer = null;
    }

    startSampling() {
        this.stopSampling();
        this.sampleTimer = setInterval(() => this.emitSample(), 1000);
    }

    stopSampling() {
        if (this.sampleTimer != null) {
            clearInterval(this.sampleTimer);
            this.sampleTimer = null;
        }
    }

    emitSample() {
        if (!this.isRecording) {
            return;
        }

        const loc = this.locationData;
        if (loc.latitude == null || loc.longitude == null) {
            return;
        }

        const speed = loc.speed || 0;
        if (speed >= 15 && this.noiseData.dbfs > -90) {
            this.session.movingDbfsSum += this.noiseData.dbfs;
            this.session.movingDbfsCount += 1;
        }

        const point = {
            index: this.session.points.length + 1,
            time: Date.now(),
            latitude: loc.latitude,
            longitude: loc.longitude,
            speed: speed,
            lateralG: this.accelerationData.lateralG || 0,
            shake: this.accelerationData.shake || 0,
            rms: this.accelerationData.rms || 0,
            freq: this.accelerationData.freq || 0,
            comfort: this.accelerationData.comfort,
            comfortClass: this.accelerationData.comfortClass,
            dbfs: this.noiseData.dbfs,
            quietness: this.getQuietness(),
            enginePct: this.noiseData.enginePct,
            roadPct: this.noiseData.roadPct,
            windPct: this.noiseData.windPct,
            engineDb: this.noiseData.engineDb,
            roadDb: this.noiseData.roadDb,
            windDb: this.noiseData.windDb,
            avgSpeed: this.getAverageSpeed(),
            distanceM: this.session.distanceM,
            elapsedMs: Date.now() - this.session.startedAt
        };

        this.session.points.push(point);
        this.notifyListeners('sample', point);
        this.notifyListeners('session', this.getSessionSummary());
    }

    getQuietness() {
        if (!this.session.movingDbfsCount) {
            return null;
        }
        return this.A.quietnessScore(this.session.movingDbfsSum / this.session.movingDbfsCount);
    }

    getAverageSpeed() {
        if (!this.session.startedAt) {
            return 0;
        }
        const elapsedSec = (Date.now() - this.session.startedAt) / 1000;
        if (elapsedSec < 1) {
            return 0;
        }
        return (this.session.distanceM / elapsedSec) * 3.6;
    }

    getLocationSnapshot() {
        return Object.assign({}, this.locationData, {
            averageSpeed: this.getAverageSpeed(),
            distanceM: this.session.distanceM,
            elapsedMs: this.session.startedAt ? Date.now() - this.session.startedAt : 0,
            quietness: this.getQuietness()
        });
    }

    getSessionSummary() {
        return {
            state: this.isRecording ? 'recording' : 'stopped',
            startedAt: this.session.startedAt,
            pointCount: this.session.points.length,
            distanceM: this.session.distanceM,
            averageSpeed: this.getAverageSpeed(),
            quietness: this.getQuietness(),
            elapsedMs: this.session.startedAt ? Date.now() - this.session.startedAt : 0
        };
    }

    resetSession() {
        this.session = this.createEmptySession();
        this.session.startedAt = Date.now();
        this.vertSamples = [];
        this.horizSamples = [];
        this.motionTimes = [];
        this.gravityReady = false;
        this.accelerationData.lateralG = 0;
        this.lastUiNotify = { acceleration: 0, noise: 0 };
    }

    isDemoMode() {
        return new URLSearchParams(window.location.search).get('demo') === '1';
    }

    stillCurrent(token) {
        return this.isRecording && this.session.startedAt === token;
    }

    startDemoLoop() {
        let step = 0;
        let lat = 34.971;
        let lng = 135.898;
        this.demoTimer = setInterval(() => {
            if (!this.isRecording) {
                return;
            }
            const t = step / 18;
            const speedMps = 11 + Math.abs(Math.sin(t * 1.3)) * 7;
            const heading = (25 + t * 28 + Math.sin(t * 2.4) * 35 + 360) % 360;
            const headingRad = heading * Math.PI / 180;
            const dt = 0.2;
            const metersPerDegLat = 111320;
            const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);
            lat += (speedMps * dt * Math.cos(headingRad)) / metersPerDegLat;
            lng += (speedMps * dt * Math.sin(headingRad)) / metersPerDegLng;

            this.handleLocationUpdate({
                timestamp: Date.now(),
                coords: {
                    latitude: lat,
                    longitude: lng,
                    speed: speedMps,
                    heading: heading,
                    accuracy: 6
                }
            });

            const corner = Math.sin(t * 2.4);
            const bump = Math.abs(Math.sin(step / 3)) > 0.85 ? 1.4 : 0.35;
            for (let k = 0; k < 4; k++) {
                const phase = (step * 4 + k) / 2;
                this.handleMotionEvent({
                    acceleration: {
                        x: corner * 2.2,
                        y: 0.05,
                        z: bump * Math.sin(phase)
                    },
                    accelerationIncludingGravity: {
                        x: 0,
                        y: 0,
                        z: 9.8
                    }
                });
            }

            this.noiseData.dbfs = -38 + Math.abs(corner) * 16 + (bump > 1 ? 8 : 0);
            let engine = 22 + Math.abs(Math.sin(t)) * 18;
            let road = 30 + Math.abs(corner) * 22;
            let wind = 18 + Math.abs(Math.sin(t * 1.7)) * 16;
            const sum = engine + road + wind;
            this.noiseData.enginePct = 100 * engine / sum;
            this.noiseData.roadPct = 100 * road / sum;
            this.noiseData.windPct = 100 * wind / sum;
            this.noiseData.quietness = this.getQuietness();
            this.notifyListeners('noise', Object.assign({}, this.noiseData));
            step += 1;
        }, 200);
    }

    stopDemoLoop() {
        if (this.demoTimer != null) {
            clearInterval(this.demoTimer);
            this.demoTimer = null;
        }
    }

    async startRecording() {
        if (this.isRecording) {
            return;
        }
        this.resetSession();
        this.isRecording = true;
        const token = this.session.startedAt;
        this.notifyListeners('session', Object.assign(this.getSessionSummary(), {
            state: 'started',
            demo: this.isDemoMode()
        }));

        if (this.isDemoMode()) {
            this.startDemoLoop();
            this.startSampling();
            return;
        }

        await this.startAccelerationTracking();
        if (!this.stillCurrent(token)) {
            this.stopAccelerationTracking();
            return;
        }
        await this.startNoiseTracking();
        if (!this.stillCurrent(token)) {
            this.stopNoiseTracking();
            return;
        }
        this.startLocationTracking();
        this.startSampling();
    }

    stopRecording() {
        if (!this.isRecording) {
            return;
        }
        const last = this.session.points[this.session.points.length - 1];
        if (!last || Date.now() - last.time > 400) {
            this.emitSample();
        }
        this.isRecording = false;
        this.stopSampling();
        this.stopDemoLoop();
        this.stopLocationTracking();
        this.stopAccelerationTracking();
        this.stopNoiseTracking();
        this.notifyListeners('session', Object.assign(this.getSessionSummary(), { state: 'stopped' }));
    }

    addDataListener(callback) {
        this.dataListeners.push(callback);
    }

    notifyListeners(type, data) {
        if (!this.isRecording && type !== 'session' && type !== 'error') {
            return;
        }
        this.dataListeners.forEach(function (callback) {
            callback(type, data);
        });
    }
}

window.sensorManager = new SensorManager();
