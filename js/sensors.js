// sensors.js
class SensorManager {
    constructor() {
        const A = window.DriveAnalysis;

        this.isRecording = false;
        this.locationData = {
            latitude: null,
            longitude: null,
            speed: 0,
            rawSpeed: 0,
            filteredSpeed: 0,
            gpsValid: false,
            gpsConfidence: 0,
            accelMps2: 0,
            heading: null,
            accuracy: null
        };
        this.longAccel = 0;
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
            shake: 0,
            combinedRms: 0,
            vibKind: 'none',
            vibLabel: '',
            vibClass: '',
            xRms: 0,
            yRms: 0,
            zRms: 0,
            xPeak: 0,
            yPeak: 0,
            zPeak: 0,
            xStd: 0,
            yStd: 0,
            zStd: 0
        };
        this.A = A;
        this.V = window.DriveVehicle;
        this.vehicle = this.V ? new this.V.VehicleAnalyzer() : null;
        this.orientation = null;
        this.vehicleSummary = null;
        this.boundOrientationHandler = this.handleOrientationEvent.bind(this);
        this.noiseData = {
            dbfs: -100,
            dbfsRaw: -100,
            calibrated: false,
            quietness: null,
            engineDb: -100,
            roadDb: -100,
            windDb: -100,
            engineDbRaw: -100,
            roadDbRaw: -100,
            windDbRaw: -100,
            engineShare: 0,
            roadShare: 0,
            windShare: 0,
            dominant: 'none',
            dominantFine: 'none',
            voiceDetected: false
        };
        this.A.FINE_BANDS.forEach((band) => {
            this.noiseData[band.key + 'Db'] = -100;
            this.noiseData[band.key + 'DbRaw'] = -100;
            this.noiseData[band.key + 'Share'] = 0;
        });

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
        this.calibrating = false;
        this.calibPeak = null;
        this.calibSavedAt = null;
        this.speechMidHistory = [];
        this.voiceHoldUntil = 0;
        this.lastCleanRaw = null;

        this.boundMotionHandler = this.handleMotionEvent.bind(this);
        this.boundLocationUpdate = this.handleLocationUpdate.bind(this);
        this.boundLocationError = this.handleLocationError.bind(this);
        this.boundNoiseFrame = this.processNoiseData.bind(this);

        this.gravity = { x: 0, y: 0, z: 9.8 };
        this.gravityReady = false;
        this.vertSamples = [];
        this.horizSamples = [];
        this.xSamples = [];
        this.ySamples = [];
        this.zSamples = [];
        this.motionTimes = [];
        this.comfortRms = [];
        this.comfortTimes = [];
        this.speedTrace = [];
        this.eventTrace = [];
        this.driveMode = 'unset';
        this.driveEvent = 'none';
        this.lastUiNotify = { acceleration: 0, noise: 0 };
        this.wakeLockSentinel = null;
        this.wakeLockRequesting = false;
        this.backgroundedAt = 0;
        this.lastGpsTimestamp = 0;
        this.lastSampleAt = 0;
        this.resumingSensors = false;
        this.gpsRestartTimer = null;

        this.sampleTimer = null;
        this.session = this.createEmptySession();
        this.dataListeners = [];
        this.loadCalibration();
        this.bindLifecycle();
    }

    bindLifecycle() {
        this.boundVisibility = () => {
            if (document.visibilityState === 'visible') {
                this.handleForeground();
            } else {
                this.handleBackground();
            }
        };
        document.addEventListener('visibilitychange', this.boundVisibility);
        window.addEventListener('pageshow', () => {
            if (document.visibilityState === 'visible') {
                this.handleForeground();
            }
        });
    }

    handleBackground() {
        if (!this.isRecording) {
            return;
        }
        this.backgroundedAt = Date.now();
        this.releaseWakeLock();
    }

    async handleForeground() {
        if (!this.isRecording || document.visibilityState !== 'visible') {
            return;
        }
        if (this.resumingSensors) {
            return;
        }
        const now = Date.now();
        const hiddenMs = this.backgroundedAt ? now - this.backgroundedAt : 0;
        const sampleGap = this.lastSampleAt ? now - this.lastSampleAt : 0;
        const gpsGap = this.lastGpsTimestamp ? now - this.lastGpsTimestamp : 0;
        this.backgroundedAt = 0;
        this.resumingSensors = true;
        try {
            await this.resumeSensors({ restartGps: hiddenMs > 1200 || gpsGap > 2500 });
            const gapMs = Math.max(hiddenMs, sampleGap);
            if (gapMs > 2500) {
                this.notifyListeners('session', Object.assign(this.getSessionSummary(), {
                    state: 'paused-gap',
                    gapMs: gapMs
                }));
            }
        } finally {
            this.resumingSensors = false;
        }
    }

    async resumeSensors(options) {
        options = options || {};
        await this.acquireWakeLock();
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (error) {
                console.error(error);
            }
        }
        if (this.isRecording && this.analyzer && this.noiseRafId == null) {
            this.processNoiseData();
        }
        if (options.restartGps && !this.isDemoMode()) {
            this.restartLocationTracking();
        }
    }

    async acquireWakeLock() {
        if (this.wakeLockSentinel || this.wakeLockRequesting) {
            return;
        }
        if (!this.isRecording || document.visibilityState !== 'visible') {
            return;
        }
        if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
            return;
        }
        this.wakeLockRequesting = true;
        try {
            const sentinel = await navigator.wakeLock.request('screen');
            this.wakeLockSentinel = sentinel;
            sentinel.addEventListener('release', () => {
                if (this.wakeLockSentinel === sentinel) {
                    this.wakeLockSentinel = null;
                }
                if (this.isRecording && document.visibilityState === 'visible' && !this.wakeLockSentinel) {
                    this.acquireWakeLock();
                }
            });
        } catch (error) {
            this.wakeLockSentinel = null;
        } finally {
            this.wakeLockRequesting = false;
        }
    }

    releaseWakeLock() {
        const sentinel = this.wakeLockSentinel;
        this.wakeLockSentinel = null;
        if (sentinel) {
            sentinel.release().catch(function () {});
        }
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

        this.stopLocationTracking();
        this.locationWatchId = navigator.geolocation.watchPosition(
            this.boundLocationUpdate,
            this.boundLocationError,
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 2000
            }
        );
    }

    restartLocationTracking() {
        if (!this.isRecording || this.isDemoMode()) {
            return;
        }
        this.startLocationTracking();
    }

    handleLocationUpdate(position) {
        const coords = position.coords;
        const rawFromGps = coords.speed != null && coords.speed >= 0
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

        let gpsQuality = {
            gpsValid: true,
            gpsConfidence: 1,
            rawSpeed: rawFromGps || 0,
            filteredSpeed: rawFromGps || 0,
            longAccel: this.longAccel,
            drivingState: 'UNKNOWN',
            reason: 'ok'
        };
        if (this.vehicle) {
            gpsQuality = this.vehicle.ingestGps({
                timestamp: position.timestamp,
                rawSpeed: rawFromGps || 0,
                accuracy: coords.accuracy,
                heading: heading,
                latitude: coords.latitude,
                longitude: coords.longitude
            });
        }

        const speedKmh = gpsQuality.filteredSpeed || 0;
        this.locationData.latitude = coords.latitude;
        this.locationData.longitude = coords.longitude;
        this.locationData.rawSpeed = gpsQuality.rawSpeed || 0;
        this.locationData.filteredSpeed = speedKmh;
        this.locationData.speed = speedKmh;
        this.locationData.gpsValid = gpsQuality.gpsValid;
        this.locationData.gpsConfidence = gpsQuality.gpsConfidence;
        this.locationData.heading = heading;
        this.locationData.accuracy = coords.accuracy;
        this.locationData.timestamp = position.timestamp;
        this.locationData.drivingState = gpsQuality.drivingState;
        this.lastGpsTimestamp = Date.now();

        if (this.isRecording && this.session.lastFix) {
            const dt = (position.timestamp - this.session.lastFix.timestamp) / 1000;
            const dist = this.A.haversineMeters(
                this.session.lastFix.latitude,
                this.session.lastFix.longitude,
                coords.latitude,
                coords.longitude
            );
            const distKmh = dt > 0 ? (dist / dt) * 3.6 : 0;
            if (dt > 0 && dist < 80 && distKmh <= 180 && gpsQuality.gpsValid) {
                this.session.distanceM += dist;
            }

            const headingDelta = (this.session.lastFix.heading != null && heading != null)
                ? this.A.wrapHeadingDelta(this.session.lastFix.heading, heading)
                : 0;
            const speedMps = speedKmh / 3.6;
            this.accelerationData.lateralG = this.A.corneringAccel(speedMps, headingDelta, dt) / this.A.G;

            const prevSpeed = this.session.lastFix.speedKmh || 0;
            const rawAccel = gpsQuality.gpsValid
                ? this.A.longitudinalAccel(prevSpeed, speedKmh, dt)
                : null;
            if (rawAccel != null) {
                this.longAccel = this.longAccel * 0.62 + rawAccel * 0.38;
            } else if (dt >= 2.5) {
                this.longAccel *= 0.5;
            }
        }
        if (this.vehicle && gpsQuality.longAccel != null) {
            this.longAccel = gpsQuality.longAccel;
        }
        this.locationData.accelMps2 = this.longAccel;
        this.speedTrace.push({
            t: position.timestamp,
            speed: speedKmh,
            accel: this.longAccel
        });
        while (this.speedTrace.length > 12) {
            this.speedTrace.shift();
        }
        this.driveEvent = this.A.classifyDriveEvent(
            speedKmh,
            this.longAccel,
            this.speedTrace,
            this.driveEvent
        );
        this.eventTrace.push({ t: position.timestamp, event: this.driveEvent });
        while (this.eventTrace.length > 16) {
            this.eventTrace.shift();
        }
        this.locationData.driveEvent = this.driveEvent;
        this.locationData.driveMode = this.driveMode;

        this.session.lastFix = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            heading: heading,
            timestamp: position.timestamp,
            speedKmh: speedKmh
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
        if (error && error.code === 3) {
            return;
        }
        if (error && error.code === 1) {
            this.notifyListeners('error', { message: '位置情報の許可が拒否されました。' });
            return;
        }
        this.notifyListeners('error', { message: '位置情報を取得できません: ' + (error && error.message ? error.message : '不明なエラー') });
        if (this.isRecording && !this.isDemoMode()) {
            clearTimeout(this.gpsRestartTimer);
            this.gpsRestartTimer = setTimeout(() => this.restartLocationTracking(), 1500);
        }
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
            this.startOrientationTracking();
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
        this.xSamples.push(linX);
        this.ySamples.push(linY);
        this.zSamples.push(linZ);
        this.motionTimes.push(now);
        while (this.motionTimes.length && now - this.motionTimes[0] > 1200) {
            this.motionTimes.shift();
            this.vertSamples.shift();
            this.horizSamples.shift();
            this.xSamples.shift();
            this.ySamples.shift();
            this.zSamples.shift();
        }

        let sampleRate = 50;
        if (this.motionTimes.length > 4) {
            const span = (this.motionTimes[this.motionTimes.length - 1] - this.motionTimes[0]) / 1000;
            sampleRate = span > 0 ? (this.motionTimes.length - 1) / span : 50;
        }

        const vib = this.A.dominantFrequency(this.vertSamples, sampleRate);
        const shakeRms = this.rms(this.horizSamples);
        const combinedRms = this.A.combineVibrationRms(vib.rms, shakeRms);
        const source = this.A.classifyVibration(vib.rms, vib.peakToPeak);
        const xStat = this.A.axisStats(this.xSamples);
        const yStat = this.A.axisStats(this.ySamples);
        const zStat = this.A.axisStats(this.zSamples);

        this.comfortRms.push(combinedRms);
        this.comfortTimes.push(now);
        while (this.comfortTimes.length && now - this.comfortTimes[0] > 12000) {
            this.comfortTimes.shift();
            this.comfortRms.shift();
        }
        const comfortSpan = this.comfortTimes.length ? now - this.comfortTimes[0] : 0;
        const comfort = comfortSpan < 3000
            ? { label: '計測中', className: '' }
            : this.A.comfortFromVibration(this.mean(this.comfortRms));

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
            combinedRms: combinedRms,
            vibKind: source.kind,
            vibLabel: source.label,
            vibClass: source.className,
            xRms: xStat.rms,
            yRms: yStat.rms,
            zRms: zStat.rms,
            xPeak: xStat.peak,
            yPeak: yStat.peak,
            zPeak: zStat.peak,
            xStd: xStat.std,
            yStd: yStat.std,
            zStd: zStat.std,
            unavailable: false
        };

        if (this.vehicle) {
            this.vehicle.ingestMotion({
                t: now,
                linX: linX,
                linY: linY,
                linZ: linZ,
                vertical: vertical,
                horizontal: horizontal,
                shake: shakeRms
            });
        }

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

    mean(values) {
        if (!values.length) {
            return 0;
        }
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            sum += values[i];
        }
        return sum / values.length;
    }

    stopAccelerationTracking() {
        window.removeEventListener('devicemotion', this.boundMotionHandler);
    }

    async startOrientationTracking() {
        if (!window.DeviceOrientationEvent) {
            return;
        }
        try {
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                if (!this.isRecording || permissionState !== 'granted') {
                    return;
                }
            }
            window.addEventListener('deviceorientation', this.boundOrientationHandler);
        } catch (error) {
            console.error(error);
        }
    }

    handleOrientationEvent(event) {
        this.orientation = {
            alpha: event.alpha,
            beta: event.beta,
            gamma: event.gamma
        };
        if (this.vehicle) {
            this.vehicle.setOrientation(this.orientation);
        }
    }

    stopOrientationTracking() {
        window.removeEventListener('deviceorientation', this.boundOrientationHandler);
        this.orientation = null;
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
            this.audioContext.onstatechange = () => {
                if (this.isRecording && this.audioContext &&
                    this.audioContext.state === 'suspended' &&
                    document.visibilityState === 'visible') {
                    this.audioContext.resume().catch(function () {});
                }
            };
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.analyzer = this.audioContext.createAnalyser();
            this.analyzer.fftSize = 4096;
            this.analyzer.minDecibels = -100;
            this.analyzer.maxDecibels = 0;
            this.analyzer.smoothingTimeConstant = 0.7;
            this.freqBuffer = new Float32Array(this.analyzer.frequencyBinCount);
            this.timeBuffer = new Float32Array(this.analyzer.fftSize);
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

        if (document.hidden || (this.audioContext && this.audioContext.state !== 'running')) {
            this.noiseRafId = requestAnimationFrame(this.boundNoiseFrame);
            return;
        }

        this.analyzer.getFloatFrequencyData(this.freqBuffer);
        this.analyzer.getFloatTimeDomainData(this.timeBuffer);

        const dbfs = this.A.dbfsFromTimeDomain(this.timeBuffer);
        const bands = this.A.audioBands(
            this.freqBuffer,
            this.audioContext.sampleRate,
            this.analyzer.fftSize,
            dbfs
        );
        const speech = this.A.speechLikelihood(
            this.freqBuffer,
            this.audioContext.sampleRate,
            this.analyzer.fftSize,
            this.speechMidHistory
        );
        this.speechMidHistory.push(speech.speechPower);
        if (this.speechMidHistory.length > 24) {
            this.speechMidHistory.shift();
        }

        const now = performance.now();
        if (speech.score >= 0.55) {
            this.voiceHoldUntil = now + 800;
        }
        const voiceDetected = now < this.voiceHoldUntil;

        if (!voiceDetected) {
            this.lastCleanRaw = Object.assign({ dbfs: dbfs }, bands);
        }

        const source = (voiceDetected && this.lastCleanRaw)
            ? this.lastCleanRaw
            : Object.assign({ dbfs: dbfs }, bands);

        this.noiseData = this.packNoise(source.dbfs, Object.assign({}, source, {
            voiceDetected: voiceDetected
        }));

        if (this.vehicle) {
            const bandDb = this.V.audioLayerBands(
                this.freqBuffer,
                this.audioContext.sampleRate,
                this.analyzer.fftSize
            );
            this.vehicle.ingestAudio({
                t: now,
                dbfs: source.dbfs,
                voice: voiceDetected,
                bandDb: bandDb
            });
        }

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
        if (this.lastGpsTimestamp && Date.now() - this.lastGpsTimestamp > 3500) {
            return;
        }

        const speed = this.locationData.filteredSpeed != null
            ? this.locationData.filteredSpeed
            : (loc.speed || 0);
        const prevPoint = this.session.points[this.session.points.length - 1];
        let sampleEvent = this.A.pickDriveEvent(
            this.driveEvent,
            this.eventTrace,
            Date.now() - 1200
        );
        if (prevPoint && prevPoint.driveEvent === 'stop' && speed >= 4 && speed < 40) {
            sampleEvent = 'launch';
        }
        const audioLive = this.isDemoMode() || (
            this.audioContext &&
            this.audioContext.state === 'running' &&
            !document.hidden
        );
        if (audioLive && speed >= 15 && !this.noiseData.voiceDetected && this.noiseData.dbfsRaw > -90) {
            this.session.movingDbfsSum += this.noiseData.dbfs;
            this.session.movingDbfsCount += 1;
        }

        const point = {
            index: this.session.points.length + 1,
            time: Date.now(),
            latitude: loc.latitude,
            longitude: loc.longitude,
            speed: speed,
            rawSpeed: loc.rawSpeed || speed,
            filteredSpeed: speed,
            gpsValid: Boolean(loc.gpsValid),
            gpsConfidence: loc.gpsConfidence || 0,
            lateralG: this.accelerationData.lateralG || 0,
            shake: this.accelerationData.shake || 0,
            rms: this.accelerationData.rms || 0,
            combinedRms: this.accelerationData.combinedRms || 0,
            freq: this.accelerationData.freq || 0,
            comfort: this.accelerationData.comfort,
            comfortClass: this.accelerationData.comfortClass,
            peak: this.accelerationData.peak || 0,
            vibKind: this.accelerationData.vibKind || 'none',
            vibLabel: this.accelerationData.vibLabel || '',
            dbfs: this.noiseData.dbfs,
            dbfsRaw: this.noiseData.dbfsRaw,
            calibrated: this.isCalibrated(),
            quietness: this.getQuietness(),
            engineDb: this.noiseData.engineDb,
            roadDb: this.noiseData.roadDb,
            windDb: this.noiseData.windDb,
            engineShare: this.noiseData.engineShare,
            roadShare: this.noiseData.roadShare,
            windShare: this.noiseData.windShare,
            dominant: this.noiseData.dominant,
            dominantFine: this.noiseData.dominantFine,
            driveMode: this.driveMode,
            driveEvent: sampleEvent,
            xRms: this.accelerationData.xRms || 0,
            yRms: this.accelerationData.yRms || 0,
            zRms: this.accelerationData.zRms || 0,
            xPeak: this.accelerationData.xPeak || 0,
            yPeak: this.accelerationData.yPeak || 0,
            zPeak: this.accelerationData.zPeak || 0,
            xStd: this.accelerationData.xStd || 0,
            yStd: this.accelerationData.yStd || 0,
            zStd: this.accelerationData.zStd || 0,
            voice: this.noiseData.voiceDetected,
            avgSpeed: this.getAverageSpeed(),
            distanceM: this.session.distanceM,
            elapsedMs: Date.now() - this.session.startedAt
        };
        this.lastSampleAt = point.time;
        this.A.FINE_BANDS.forEach((band) => {
            point[band.key + 'Db'] = this.noiseData[band.key + 'Db'];
            point[band.key + 'Share'] = this.noiseData[band.key + 'Share'];
        });
        if (this.vehicle) {
            Object.assign(point, this.vehicle.buildSample());
        }

        this.session.points.push(point);
        this.notifyListeners('sample', point);
        this.notifyListeners('session', this.getSessionSummary());
    }

    getQuietness() {
        if (!this.session.movingDbfsCount) {
            return null;
        }
        return this.A.quietnessScore(
            this.session.movingDbfsSum / this.session.movingDbfsCount,
            this.isCalibrated()
        );
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
            quietness: this.getQuietness(),
            driveEvent: this.driveEvent,
            driveMode: this.driveMode,
            drivingState: this.locationData.drivingState,
            gpsValid: this.locationData.gpsValid,
            gpsConfidence: this.locationData.gpsConfidence,
            rawSpeed: this.locationData.rawSpeed,
            filteredSpeed: this.locationData.filteredSpeed,
            vehicle: this.vehicle ? this.vehicle.getSnapshot() : null
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
            elapsedMs: this.session.startedAt ? Date.now() - this.session.startedAt : 0,
            driveMode: this.driveMode,
            driveEvent: this.driveEvent,
            drivingState: this.locationData.drivingState,
            quietnessScore: this.vehicleSummary && this.vehicleSummary.quietnessScore != null
                ? this.vehicleSummary.quietnessScore
                : (this.vehicle && this.vehicle.getSnapshot().quietnessScore),
            rideComfortScore: this.vehicleSummary && this.vehicleSummary.rideComfortScore != null
                ? this.vehicleSummary.rideComfortScore
                : (this.vehicle && this.vehicle.getSnapshot().rideComfortScore),
            powertrainSmoothnessScore: this.vehicleSummary && this.vehicleSummary.powertrainSmoothnessScore != null
                ? this.vehicleSummary.powertrainSmoothnessScore
                : (this.vehicle && this.vehicle.getSnapshot().powertrainSmoothnessScore),
            character: this.vehicleSummary && this.vehicleSummary.character,
            comments: this.vehicleSummary && this.vehicleSummary.comments,
            speedBands: this.vehicleSummary && this.vehicleSummary.speedBands,
            eventStats: this.vehicleSummary && this.vehicleSummary.eventStats,
            vehicle: this.vehicle ? this.vehicle.getSnapshot() : null
        };
    }

    getRecordedPoints() {
        return this.session.points.slice();
    }

    resetSession() {
        this.session = this.createEmptySession();
        this.session.startedAt = Date.now();
        this.vertSamples = [];
        this.horizSamples = [];
        this.xSamples = [];
        this.ySamples = [];
        this.zSamples = [];
        this.motionTimes = [];
        this.comfortRms = [];
        this.comfortTimes = [];
        this.speedTrace = [];
        this.eventTrace = [];
        this.driveEvent = 'none';
        this.gravityReady = false;
        this.accelerationData.lateralG = 0;
        this.longAccel = 0;
        this.locationData.accelMps2 = 0;
        this.lastUiNotify = { acceleration: 0, noise: 0 };
        this.backgroundedAt = 0;
        this.lastGpsTimestamp = 0;
        this.lastSampleAt = 0;
        this.speechMidHistory = [];
        this.voiceHoldUntil = 0;
        this.lastCleanRaw = null;
        this.vehicleSummary = null;
        this.locationData.rawSpeed = 0;
        this.locationData.filteredSpeed = 0;
        this.locationData.gpsValid = false;
        this.locationData.gpsConfidence = 0;
        this.locationData.drivingState = 'UNKNOWN';
        if (this.vehicle) {
            this.vehicle.reset();
        }
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
            try {
            const t = step / 18;
            const cycle = step % 100;
            let speedMps;
            if (cycle < 15) {
                speedMps = 0;
            } else if (cycle < 28) {
                speedMps = ((cycle - 15) / 13) * 5;
            } else if (cycle < 42) {
                speedMps = 4.6 + Math.sin(t * 1.4) * 0.35;
            } else if (cycle < 78) {
                speedMps = 13.5 + Math.sin(t * 0.8) * 0.7;
            } else {
                speedMps = Math.max(0, 13.5 - ((cycle - 78) / 22) * 13.5);
            }
            const heading = (25 + t * 28 + Math.sin(t * 2.4) * 35 + 360) % 360;
            const headingRad = heading * Math.PI / 180;
            const dt = 0.2;
            const metersPerDegLat = 111320;
            const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);
            lat += (speedMps * dt * Math.cos(headingRad)) / metersPerDegLat;
            lng += (speedMps * dt * Math.sin(headingRad)) / metersPerDegLng;

            const gpsSpike = cycle === 44;
            this.handleLocationUpdate({
                timestamp: Date.now(),
                coords: {
                    latitude: lat,
                    longitude: lng,
                    speed: gpsSpike ? 2200 / 3.6 : speedMps,
                    heading: heading,
                    accuracy: 6
                }
            });

            const kmh = speedMps * 3.6;
            const corner = Math.sin(t * 2.4);
            const lowSpeed = kmh >= 8 && kmh <= 22;
            const launchRise = cycle >= 15 && cycle < 36;
            const bump = Math.abs(Math.sin(step / 3)) > 0.88 ? 1.9 : (lowSpeed ? 0.42 : 0.16);
            const shakeX = (lowSpeed ? 0.62 : 0.12) + Math.abs(corner) * 0.25;
            for (let k = 0; k < 4; k++) {
                const phase = (step * 4 + k) / 2;
                this.handleMotionEvent({
                    acceleration: {
                        x: shakeX * Math.sin(phase * 0.7),
                        y: (launchRise ? 0.22 : 0.04) + (cycle < 15 ? 0.01 : 0),
                        z: bump * Math.sin(phase)
                    },
                    accelerationIncludingGravity: {
                        x: 0,
                        y: 0,
                        z: 9.8
                    }
                });
            }

            const raw = -40 + Math.abs(corner) * 10 + (bump > 1 ? 8 : 0) + (lowSpeed ? 6 : 0);
            const engineP = (cycle < 15 ? 0.55 : 0.18) + (launchRise ? 0.28 : 0);
            const roadP = 0.30 + Math.abs(corner) * 0.22 + (bump > 1 ? 0.2 : 0) + Math.max(0, speedMps - 8) * 0.02;
            const windP = 0.08 + Math.max(0, speedMps - 10) * 0.04 + Math.abs(Math.sin(t * 1.7)) * 0.05;
            const bands = this.A.splitOverallDbfs(raw, engineP, roadP, windP);
            this.noiseData = this.packNoise(raw, bands);
            if (this.vehicle) {
                const lf = cycle < 15 ? -26 : (launchRise ? -34 + (cycle - 15) * 0.55 : -38);
                const power = cycle < 15 ? -28 : (launchRise ? -36 + (cycle - 15) * 0.4 : -40);
                this.vehicle.ingestAudio({
                    t: performance.now(),
                    dbfs: raw,
                    voice: false,
                    bandDb: {
                        lf: lf,
                        power: power,
                        mid: -42 + Math.abs(corner) * 4,
                        upper: -46 + Math.max(0, speedMps - 6) * 0.6,
                        high: -50 + Math.max(0, speedMps - 10) * 0.9,
                        broadband: -40 + Math.max(0, speedMps) * 0.5 + Math.abs(corner) * 3,
                        aero: -52 + Math.max(0, speedMps - 10) * 1.1
                    }
                });
            }
            this.notifyListeners('noise', Object.assign({}, this.noiseData));
            } catch (error) {
                console.error(error);
            }
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
        if (this.calibrating) {
            this.notifyListeners('error', { message: '校正中は計測を開始できません。' });
            return;
        }
        this.resetSession();
        this.isRecording = true;
        await this.acquireWakeLock();
        const token = this.session.startedAt;
        this.notifyListeners('session', Object.assign(this.getSessionSummary(), {
            state: 'started',
            demo: this.isDemoMode(),
            wakeLock: Boolean(this.wakeLockSentinel)
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
        this.releaseWakeLock();
        if (this.gpsRestartTimer) {
            clearTimeout(this.gpsRestartTimer);
            this.gpsRestartTimer = null;
        }
        this.stopSampling();
        this.stopDemoLoop();
        this.stopLocationTracking();
        this.stopAccelerationTracking();
        this.stopOrientationTracking();
        this.stopNoiseTracking();
        if (this.vehicle) {
            this.vehicleSummary = this.vehicle.finalize(this.session.points);
        }
        this.notifyListeners('session', Object.assign(this.getSessionSummary(), { state: 'stopped' }));
    }

    packNoise(rawDbfs, extra) {
        extra = extra || {};
        const calibrated = this.isCalibrated();
        const engineRaw = extra.engineDb != null ? extra.engineDb : this.noiseData.engineDbRaw;
        const roadRaw = extra.roadDb != null ? extra.roadDb : this.noiseData.roadDbRaw;
        const windRaw = extra.windDb != null ? extra.windDb : this.noiseData.windDbRaw;
        const engineShare = extra.engineShare != null ? extra.engineShare : this.noiseData.engineShare;
        const roadShare = extra.roadShare != null ? extra.roadShare : this.noiseData.roadShare;
        const windShare = extra.windShare != null ? extra.windShare : this.noiseData.windShare;
        const packed = {
            dbfsRaw: rawDbfs,
            dbfs: this.applyCal(rawDbfs),
            calibrated: calibrated,
            quietness: this.getQuietness(),
            engineDbRaw: engineRaw,
            roadDbRaw: roadRaw,
            windDbRaw: windRaw,
            engineDb: this.applyCal(engineRaw),
            roadDb: this.applyCal(roadRaw),
            windDb: this.applyCal(windRaw),
            engineShare: engineShare || 0,
            roadShare: roadShare || 0,
            windShare: windShare || 0,
            dominant: extra.dominant || this.noiseData.dominant || 'none',
            dominantFine: extra.dominantFine || this.noiseData.dominantFine || 'none',
            voiceDetected: Boolean(extra.voiceDetected)
        };
        this.A.FINE_BANDS.forEach((band) => {
            const raw = extra[band.key + 'Db'] != null
                ? extra[band.key + 'Db']
                : this.noiseData[band.key + 'DbRaw'];
            packed[band.key + 'DbRaw'] = raw;
            packed[band.key + 'Db'] = this.applyCal(raw);
            packed[band.key + 'Share'] = extra[band.key + 'Share'] != null
                ? extra[band.key + 'Share']
                : (this.noiseData[band.key + 'Share'] || 0);
        });
        return packed;
    }

    isCalibrated() {
        return this.calibPeak != null;
    }

    applyCal(dbfs) {
        if (this.calibPeak == null) {
            return dbfs;
        }
        return dbfs - this.calibPeak;
    }

    getCalibrationInfo() {
        return {
            calibrated: this.isCalibrated(),
            peakDbfs: this.calibPeak,
            savedAt: this.calibSavedAt
        };
    }

    loadCalibration() {
        try {
            const raw = localStorage.getItem('driveanalytics.noiseCal.v1');
            if (!raw) {
                this.calibPeak = null;
                this.calibSavedAt = null;
                return;
            }
            const data = JSON.parse(raw);
            this.calibPeak = typeof data.peakDbfs === 'number' ? data.peakDbfs : null;
            this.calibSavedAt = data.savedAt || null;
        } catch (error) {
            this.calibPeak = null;
            this.calibSavedAt = null;
        }
    }

    saveCalibration(peakDbfs) {
        this.calibPeak = peakDbfs;
        this.calibSavedAt = new Date().toISOString();
        localStorage.setItem('driveanalytics.noiseCal.v1', JSON.stringify({
            peakDbfs: peakDbfs,
            savedAt: this.calibSavedAt
        }));
    }

    clearCalibration() {
        this.calibPeak = null;
        this.calibSavedAt = null;
        localStorage.removeItem('driveanalytics.noiseCal.v1');
    }

    cancelCalibration() {
        this.calibrating = false;
    }

    async captureCalibrationPeak(durationMs, onProgress) {
        if (this.isRecording) {
            throw new Error('計測中は校正できません。先に停止してください。');
        }
        if (this.calibrating) {
            throw new Error('校正を実行中です。');
        }

        this.calibrating = true;
        let stream = null;
        let audioContext = null;
        let rafId = null;

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                },
                video: false
            });
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 4096;
            analyser.smoothingTimeConstant = 0;
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            const timeBuffer = new Float32Array(analyser.fftSize);
            const started = performance.now();
            let peak = -100;

            await new Promise((resolve) => {
                const tick = () => {
                    if (!this.calibrating) {
                        resolve();
                        return;
                    }
                    analyser.getFloatTimeDomainData(timeBuffer);
                    const dbfs = this.A.dbfsFromTimeDomain(timeBuffer);
                    if (dbfs > peak) {
                        peak = dbfs;
                    }
                    const remainMs = Math.max(0, durationMs - (performance.now() - started));
                    if (onProgress) {
                        onProgress({ current: dbfs, peak: peak, remainMs: remainMs });
                    }
                    if (remainMs <= 0) {
                        resolve();
                        return;
                    }
                    rafId = requestAnimationFrame(tick);
                };
                tick();
            });

            return {
                peakDbfs: peak,
                clipped: peak > -1.2,
                tooQuiet: peak < -42
            };
        } finally {
            this.calibrating = false;
            if (rafId != null) {
                cancelAnimationFrame(rafId);
            }
            if (stream) {
                stream.getTracks().forEach(function (track) {
                    track.stop();
                });
            }
            if (audioContext) {
                audioContext.close();
            }
        }
    }

    setDriveMode(id) {
        const known = this.A.DRIVE_MODES.some(function (mode) {
            return mode.id === id;
        });
        this.driveMode = known ? id : 'unset';
        this.notifyListeners('mode', { driveMode: this.driveMode });
        return this.driveMode;
    }

    getDriveMode() {
        return this.driveMode;
    }

    addDataListener(callback) {
        this.dataListeners.push(callback);
    }

    notifyListeners(type, data) {
        if (!this.isRecording && type !== 'session' && type !== 'error' && type !== 'mode') {
            return;
        }
        this.dataListeners.forEach(function (callback) {
            callback(type, data);
        });
    }
}

window.sensorManager = new SensorManager();
