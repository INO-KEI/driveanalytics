// ui.js
class UIManager {
    constructor(sensorManager) {
        this.sensorManager = sensorManager;
        this.A = window.DriveAnalysis;
        this.map = null;
        this.marker = null;
        this.polyline = null;
        this.spotLayer = null;
        this.trackPoints = [];
        this.colorMode = 'noise';
        this.followMap = true;
        this.selectedRowIndex = null;

        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.coordinatesElement = document.getElementById('coordinates');
        this.speedElement = document.getElementById('speed');
        this.gpsQualityElement = document.getElementById('gps-quality');
        this.driveEventElement = document.getElementById('drive-event');
        this.engineStateElement = document.getElementById('engine-state');
        this.driveModeElement = document.getElementById('drive-mode');
        this.longAccelElement = document.getElementById('long-accel');
        this.avgSpeedElement = document.getElementById('average-speed');
        this.distanceElement = document.getElementById('distance');
        this.durationElement = document.getElementById('duration');
        this.accelerationElement = document.getElementById('acceleration');
        this.vibrationXyzElement = document.getElementById('vibration-xyz');
        this.vibrationLevelElement = document.getElementById('vibration-level');
        this.vibrationCombinedElement = document.getElementById('vibration-combined');
        this.vibrationSourceElement = document.getElementById('vibration-source');
        this.vibrationFreqElement = document.getElementById('vibration-freq');
        this.comfortElement = document.getElementById('comfort');
        this.lateralElement = document.getElementById('lateral-g');
        this.shakeElement = document.getElementById('lateral-shake');
        this.rideSplitElement = document.getElementById('ride-split');
        this.noiseLevelElement = document.getElementById('noise-level');
        this.quietnessElement = document.getElementById('quietness');
        this.engineBar = document.getElementById('band-engine');
        this.roadBar = document.getElementById('band-road');
        this.windBar = document.getElementById('band-wind');
        this.engineLabel = document.getElementById('band-engine-label');
        this.roadLabel = document.getElementById('band-road-label');
        this.windLabel = document.getElementById('band-wind-label');
        this.fineBars = {};
        this.fineLabels = {};
        this.A.FINE_BANDS.forEach((band) => {
            this.fineBars[band.key] = document.getElementById('band-' + band.key);
            this.fineLabels[band.key] = document.getElementById('band-' + band.key + '-label');
        });
        this.tableBody = document.getElementById('track-table-body');
        this.tableScroll = document.querySelector('.table-scroll');
        this.tableEmpty = document.getElementById('track-empty');
        this.csvSaveButton = document.getElementById('csvSave');
        this.csvMailButton = document.getElementById('csvMail');
        this.statusBanner = document.getElementById('status-banner');
        this.colorNoiseButton = document.getElementById('colorNoise');
        this.colorVibButton = document.getElementById('colorVib');
        this.noiseHint = document.getElementById('noise-hint');
        this.voiceFlag = document.getElementById('voice-flag');
        this.noiseDominant = document.getElementById('noise-dominant');
        this.noiseIndependent = document.getElementById('noise-independent');
        this.evLikelihoodElement = document.getElementById('ev-likelihood');
        this.scoreQuietness = document.getElementById('score-quietness');
        this.scoreRide = document.getElementById('score-ride');
        this.scorePowertrain = document.getElementById('score-powertrain');
        this.scoreEngineFill = document.getElementById('score-engine-fill');
        this.scoreRoadFill = document.getElementById('score-road-fill');
        this.scoreWindFill = document.getElementById('score-wind-fill');
        this.scoreEngineLabel = document.getElementById('score-engine-label');
        this.scoreRoadLabel = document.getElementById('score-road-label');
        this.scoreWindLabel = document.getElementById('score-wind-label');
        this.charLowShake = document.getElementById('char-low-shake');
        this.charCruise = document.getElementById('char-cruise');
        this.charPt = document.getElementById('char-pt');
        this.charRoad = document.getElementById('char-road');
        this.charWind = document.getElementById('char-wind');
        this.charLowPt = document.getElementById('char-low-pt');
        this.driveComments = document.getElementById('drive-comments');
        this.debugPanel = document.getElementById('debug-panel');
        this.debugMode = new URLSearchParams(window.location.search).get('debug') === '1';
        this.settingsButton = document.getElementById('settingsButton');
        this.settingsPanel = document.getElementById('settings-panel');
        this.settingsClose = document.getElementById('settingsClose');
        this.calStatus = document.getElementById('cal-status');
        this.calLive = document.getElementById('cal-live');
        this.calPeak = document.getElementById('cal-peak');
        this.calRemain = document.getElementById('cal-remain');
        this.calMeterFill = document.getElementById('cal-meter-fill');
        this.calMessage = document.getElementById('cal-message');
        this.calStart = document.getElementById('calStart');
        this.calSave = document.getElementById('calSave');
        this.calClear = document.getElementById('calClear');
        this.pendingCalPeak = null;
        this.charts = new NervCharts();

        this.initMap();
        this.initEventListeners();
        this.showCompatibility();
        this.refreshCalibrationStatus();
        this.updateNoiseHint();
        this.observeCockpit();
        this.syncModeChips(this.sensorManager.getDriveMode());
        if (this.debugPanel && this.debugMode) {
            this.debugPanel.hidden = false;
        }
    }

    showCompatibility() {
        if (typeof checkCompatibility !== 'function') {
            return;
        }
        const warnings = checkCompatibility();
        if (warnings.length) {
            this.showStatus(warnings.join(' '), true);
        }
    }

    showStatus(message, isError) {
        if (!this.statusBanner) {
            return;
        }
        if (!isError) {
            this.statusBanner.hidden = true;
            return;
        }
        this.statusBanner.hidden = !message;
        this.statusBanner.textContent = message || '';
    }

    observeCockpit() {
        const cockpit = document.getElementById('cockpit');
        if (!cockpit || typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(() => {
            if (this.map) {
                this.map.invalidateSize();
            }
            if (this.charts) {
                this.charts.fitCanvases();
            }
        });
        observer.observe(cockpit);
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                if (this.map) {
                    this.map.invalidateSize();
                }
                if (this.charts) {
                    this.charts.fitCanvases();
                }
            }, 250);
        });
    }

    pushChart(partial) {
        if (this.charts) {
            this.charts.ingest(partial);
        }
    }

    initMap() {
        this.map = L.map('map').setView([35.6895, 139.6917], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(this.map);
        this.spotLayer = L.layerGroup().addTo(this.map);
        this.polyline = L.polyline([], {
            color: '#ff7a18',
            weight: 3,
            opacity: 0.9
        }).addTo(this.map);
        setTimeout(() => this.map.invalidateSize(), 200);
    }

    initEventListeners() {
        this.startButton.addEventListener('click', async () => {
            this.startButton.disabled = true;
            this.stopButton.disabled = false;
            this.followMap = true;
            try {
                await this.sensorManager.startRecording();
            } catch (error) {
                this.startButton.disabled = false;
                this.stopButton.disabled = true;
                this.showStatus('計測を開始できませんでした。', true);
                console.error(error);
            }
        });

        this.stopButton.addEventListener('click', () => {
            this.sensorManager.stopRecording();
            this.startButton.disabled = false;
            this.stopButton.disabled = true;
            this.followMap = false;
        });

        this.colorNoiseButton.addEventListener('click', () => this.setColorMode('noise'));
        this.colorVibButton.addEventListener('click', () => this.setColorMode('vib'));
        document.querySelectorAll('.mode-chip').forEach((button) => {
            button.addEventListener('click', () => {
                const id = button.dataset.mode;
                const current = this.sensorManager.getDriveMode();
                this.sensorManager.setDriveMode(current === id ? 'unset' : id);
            });
        });
        this.settingsButton.addEventListener('click', () => this.openSettings());
        this.settingsClose.addEventListener('click', () => this.closeSettings());
        this.settingsPanel.addEventListener('click', (event) => {
            if (event.target === this.settingsPanel) {
                this.closeSettings();
            }
        });
        this.calStart.addEventListener('click', () => this.runCalibration());
        this.calSave.addEventListener('click', () => this.savePendingCalibration());
        this.calClear.addEventListener('click', () => this.clearCalibration());
        this.csvSaveButton.addEventListener('click', () => this.downloadCsv());
        this.csvMailButton.addEventListener('click', () => this.shareCsv());

        this.tableBody.addEventListener('click', (event) => {
            const row = event.target.closest('tr');
            if (!row || !row.dataset.index) {
                return;
            }
            this.focusPoint(Number(row.dataset.index));
        });

        this.sensorManager.addDataListener(this.updateUI.bind(this));
    }

    openSettings() {
        this.settingsPanel.hidden = false;
        this.refreshCalibrationStatus();
        this.calMessage.textContent = this.sensorManager.isRecording
            ? '計測中は校正できません。先に停止してください。'
            : '';
        this.calStart.disabled = this.sensorManager.isRecording;
    }

    closeSettings() {
        this.sensorManager.cancelCalibration();
        this.settingsPanel.hidden = true;
        this.updateNoiseHint();
    }

    refreshCalibrationStatus() {
        const info = this.sensorManager.getCalibrationInfo();
        if (!info.calibrated) {
            this.calStatus.textContent = '未校正';
            this.calClear.disabled = true;
            return;
        }
        const when = info.savedAt ? this.A.formatClock(new Date(info.savedAt)) : '';
        this.calStatus.textContent = `校正済み（基準ピーク ${info.peakDbfs.toFixed(1)} dBFS）${when ? ' ' + when : ''}`;
        this.calClear.disabled = false;
    }

    updateNoiseHint() {
        if (!this.noiseHint) {
            return;
        }
        this.noiseHint.textContent = this.sensorManager.isCalibrated()
            ? '校正済みです。0 dB は校正音と同じ大きさです。未校正時のような絶対音圧(dB SPL)ではありません。'
            : '未校正です。表示は Relative Sound Level（相対音量）です。XX dB を絶対音圧として解釈しないでください。';
    }

    async runCalibration() {
        if (this.sensorManager.isRecording) {
            this.calMessage.textContent = '計測中は校正できません。';
            return;
        }
        this.pendingCalPeak = null;
        this.calSave.disabled = true;
        this.calStart.disabled = true;
        this.calMessage.textContent = '準備ができたらカスタネットを1回鳴らしてください。';
        try {
            const result = await this.sensorManager.captureCalibrationPeak(8000, (progress) => {
                this.calLive.textContent = `${progress.current.toFixed(1)} dBFS`;
                this.calPeak.textContent = `${progress.peak.toFixed(1)} dBFS`;
                this.calRemain.textContent = `${Math.ceil(progress.remainMs / 1000)} 秒`;
                const meter = this.A.clamp((progress.current + 60) / 60, 0, 1);
                this.calMeterFill.style.width = `${Math.round(meter * 100)}%`;
            });
            this.pendingCalPeak = result.peakDbfs;
            this.calPeak.textContent = `${result.peakDbfs.toFixed(1)} dBFS`;
            if (result.clipped) {
                this.calMessage.textContent = '振り切れています。少し離してやり直してください。';
                this.calSave.disabled = true;
            } else if (result.tooQuiet) {
                this.calMessage.textContent = '音が小さすぎます。近づけてやり直してください。';
                this.calSave.disabled = true;
            } else {
                this.calMessage.textContent = 'ピークを記録しました。よければ「このピークを採用」を押してください。';
                this.calSave.disabled = false;
            }
        } catch (error) {
            this.calMessage.textContent = error.message || '校正に失敗しました。';
        } finally {
            this.calStart.disabled = this.sensorManager.isRecording;
            this.calRemain.textContent = '0 秒';
        }
    }

    savePendingCalibration() {
        if (this.pendingCalPeak == null) {
            return;
        }
        this.sensorManager.saveCalibration(this.pendingCalPeak);
        this.pendingCalPeak = null;
        this.calSave.disabled = true;
        this.refreshCalibrationStatus();
        this.updateNoiseHint();
        this.calMessage.textContent = '校正値を保存しました。同じ基準音で合わせた端末同士を比較できます。';
    }

    clearCalibration() {
        this.sensorManager.clearCalibration();
        this.pendingCalPeak = null;
        this.calSave.disabled = true;
        this.refreshCalibrationStatus();
        this.updateNoiseHint();
        this.calMessage.textContent = '校正を解除しました。';
    }

    noiseUnit(calibrated) {
        return calibrated ? 'dB（校正基準比）' : 'Relative Sound Level';
    }

    setColorMode(mode) {
        this.colorMode = mode;
        this.colorNoiseButton.classList.toggle('is-active', mode === 'noise');
        this.colorVibButton.classList.toggle('is-active', mode === 'vib');
        this.redrawSpots();
    }

    updateUI(type, data) {
        switch (type) {
            case 'location':
                this.updateLocationUI(data);
                break;
            case 'acceleration':
                this.updateAccelerationUI(data);
                break;
            case 'noise':
                this.updateNoiseUI(data);
                break;
            case 'sample':
                this.addTrackPoint(data);
                break;
            case 'mode':
                this.syncModeChips(data.driveMode);
                break;
            case 'session':
                this.handleSession(data);
                break;
            case 'error':
                this.showStatus(data.message, true);
                break;
        }
    }

    handleSession(data) {
        const sys = document.querySelector('.hdr-sys');
        if (data.state === 'started') {
            this.resetTrack();
            if (sys) {
                sys.textContent = data.demo ? 'MAGI-LINK // DEMO' : 'MAGI-LINK // ACTIVE';
            }
        }
        if (data.state === 'stopped') {
            this.fitTrack();
            if (sys) {
                sys.textContent = 'MAGI-LINK // READY';
            }
        }
        if (this.avgSpeedElement && data.averageSpeed != null) {
            this.avgSpeedElement.textContent = `平均速度: ${data.averageSpeed.toFixed(1)} km/h`;
        }
        if (this.distanceElement && data.distanceM != null) {
            this.distanceElement.textContent = `走行距離: ${(data.distanceM / 1000).toFixed(2)} km`;
        }
        if (this.durationElement && data.elapsedMs != null) {
            this.durationElement.textContent = `計測時間: ${this.A.formatDuration(data.elapsedMs)}`;
        }
        if (this.quietnessElement && data.quietnessScore != null) {
            this.quietnessElement.textContent = `Quietness: ${data.quietnessScore} / 100`;
        } else if (this.quietnessElement && data.quietness != null) {
            this.quietnessElement.textContent = `Quietness: ${data.quietness} / 100`;
        }
        this.updateScoreCards(data);
        if (data.state === 'stopped') {
            this.renderCharacter(data);
        }
        if (data.state === 'started') {
            this.clearCharacter();
        }
        this.setExportEnabled(this.sensorManager.getRecordedPoints().length > 0);
    }

    resetTrack() {
        this.trackPoints = [];
        this.selectedRowIndex = null;
        this.spotLayer.clearLayers();
        this.polyline.setLatLngs([]);
        this.tableBody.innerHTML = '';
        this.tableEmpty.hidden = false;
        this.setExportEnabled(false);
        if (this.charts) {
            this.charts.clear();
        }
        this.clearCharacter();
        if (this.marker) {
            this.map.removeLayer(this.marker);
            this.marker = null;
        }
    }

    updateLocationUI(data) {
        this.coordinatesElement.textContent =
            `緯度: ${data.latitude.toFixed(6)} 経度: ${data.longitude.toFixed(6)}`;
        this.speedElement.textContent = `速度: ${(data.filteredSpeed != null ? data.filteredSpeed : data.speed || 0).toFixed(1)} km/h`;
        if (this.gpsQualityElement) {
            const valid = data.gpsValid !== false;
            const conf = data.gpsConfidence != null ? data.gpsConfidence : (valid ? 1 : 0);
            this.gpsQualityElement.textContent = valid
                ? `GPS: 有効 (${(conf * 100).toFixed(0)}%)`
                : `GPS: 除外 (raw ${(data.rawSpeed || 0).toFixed(0)} km/h)`;
            this.gpsQualityElement.className = valid ? '' : 'gps-bad';
        }
        if (this.driveEventElement) {
            this.driveEventElement.textContent = `状態: ${this.eventLabel(data.drivingState || data.driveEvent)}`;
        }
        if (this.engineStateElement && data.vehicle) {
            this.engineStateElement.textContent =
                `パワートレーン: ${this.engineStateLabel(data.vehicle.engineState)} / p=${(data.vehicle.engineProbability || 0).toFixed(2)}`;
        }
        if (this.driveModeElement && data.driveMode) {
            this.driveModeElement.textContent = `モード: ${this.modeLabel(data.driveMode)}`;
        }
        if (this.longAccelElement) {
            const accel = data.accelMps2 || 0;
            const sign = accel > 0.05 ? '+' : '';
            this.longAccelElement.textContent = `加速: ${sign}${accel.toFixed(2)} m/s²`;
        }
        if (data.averageSpeed != null) {
            this.avgSpeedElement.textContent = `平均速度: ${data.averageSpeed.toFixed(1)} km/h`;
        }
        if (data.distanceM != null) {
            this.distanceElement.textContent = `走行距離: ${(data.distanceM / 1000).toFixed(2)} km`;
        }
        if (data.elapsedMs != null) {
            this.durationElement.textContent = `計測時間: ${this.A.formatDuration(data.elapsedMs)}`;
        }

        const latlng = [data.latitude, data.longitude];
        if (this.marker) {
            this.marker.setLatLng(latlng);
        } else {
            this.marker = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'angel-marker-wrap',
                    html: '<span class="angel-marker">▼</span>',
                    iconSize: [28, 28],
                    iconAnchor: [14, 24]
                }),
                keyboard: false,
                zIndexOffset: 1200
            }).addTo(this.map);
        }
        if (this.followMap) {
            this.map.panTo(latlng, { animate: true, duration: 0.4 });
        }
        this.pushChart({
            speed: data.speed || 0,
            accelMps2: data.accelMps2 || 0,
            driveEvent: data.driveEvent || 'none',
            drivingState: data.drivingState || data.driveEvent || 'none'
        });
        this.updateScoreCards(data);
        this.updateDebug(data.vehicle);
    }

    updateAccelerationUI(data) {
        this.accelerationElement.textContent =
            `上下: ${data.vertical.toFixed(2)} 横揺れ: ${data.horizontal.toFixed(2)} m/s²`;
        if (this.vibrationXyzElement) {
            this.vibrationXyzElement.textContent =
                `XYZ RMS: ${(data.xRms || 0).toFixed(2)}/${(data.yRms || 0).toFixed(2)}/${(data.zRms || 0).toFixed(2)} ` +
                `Peak: ${(data.xPeak || 0).toFixed(2)}/${(data.yPeak || 0).toFixed(2)}/${(data.zPeak || 0).toFixed(2)} ` +
                `Std: ${(data.xStd || 0).toFixed(2)}/${(data.yStd || 0).toFixed(2)}/${(data.zStd || 0).toFixed(2)}`;
        }

        const hasSignal = Math.abs(data.vertical) > 0.01 || Math.abs(data.horizontal) > 0.01 || data.rms > 0.01 || data.shake > 0.01;
        if (!hasSignal && data.x === 0 && data.y === 0 && data.z === 0) {
            this.vibrationLevelElement.textContent = '振幅: 計測不能';
            this.vibrationLevelElement.className = 'level-error';
            if (this.vibrationCombinedElement) {
                this.vibrationCombinedElement.textContent = '合成 RMS: 計測不能';
                this.vibrationCombinedElement.className = 'level-error';
            }
            this.comfortElement.textContent = '判定: 計測不能';
            this.comfortElement.className = 'level-error';
            return;
        }

        if (this.vibrationCombinedElement) {
            this.vibrationCombinedElement.textContent =
                `合成 RMS: ${(data.combinedRms || 0).toFixed(2)} m/s²（上下と横揺れの二乗和平方根）`;
            this.vibrationCombinedElement.className = data.comfortClass || '';
        }
        if (this.vibrationSourceElement) {
            this.vibrationSourceElement.textContent = `要因: ${data.vibLabel || '--'}`;
            this.vibrationSourceElement.className = data.vibClass || '';
        }
        this.vibrationLevelElement.textContent =
            `上下 RMS: ${(data.rms || 0).toFixed(2)} m/s²（振れ幅 ${(data.peak || 0).toFixed(2)}）`;
        this.vibrationLevelElement.className = data.comfortClass || '';
        this.vibrationFreqElement.textContent = `卓越周波数: ${(data.freq || 0).toFixed(1)} Hz`;
        this.comfortElement.textContent = `判定: ${data.comfort}`;
        this.comfortElement.className = data.comfortClass || '';
        this.lateralElement.textContent = `横G（コーナリング）: ${Math.abs(data.lateralG || 0).toFixed(2)} G`;
        this.shakeElement.textContent = `Shake: ${(data.shake || 0).toFixed(2)} m/s²`;
        const vehicle = this.sensorManager.vehicle ? this.sensorManager.vehicle.getSnapshot() : null;
        if (this.rideSplitElement && vehicle) {
            this.rideSplitElement.textContent =
                `Ride: 振動 ${vehicle.rideVibrationScore.toFixed(0)} / Shake ${vehicle.rideShakeScore.toFixed(0)} / Impact ${vehicle.rideImpactScore.toFixed(0)} / 安定 ${vehicle.rideStabilityScore.toFixed(0)}`;
        }
        this.pushChart({
            rms: data.rms || 0,
            shake: data.shake || 0,
            combinedRms: vehicle ? vehicle.continuousVibration : (data.combinedRms || 0),
            peak: data.peak || 0,
            freq: data.freq || 0,
            comfort: data.comfort || '',
            comfortClass: data.comfortClass || '',
            vibKind: data.vibKind || 'none',
            vibLabel: data.vibLabel || '',
            vibClass: data.vibClass || '',
            impactScore: vehicle ? vehicle.impactScore : 0,
            impactEvent: vehicle ? vehicle.impactEvent : false
        });
        this.updateScoreCards({ vehicle: vehicle });
        this.updateDebug(vehicle);
    }

    updateNoiseUI(data) {
        const unit = this.noiseUnit(data.calibrated);
        this.noiseLevelElement.textContent = data.calibrated
            ? `音圧: ${data.dbfs.toFixed(1)} ${unit}`
            : `相対音量: ${data.dbfs.toFixed(1)} ${unit}`;
        const vehicle = this.sensorManager.vehicle ? this.sensorManager.vehicle.getSnapshot() : null;
        if (vehicle && vehicle.quietnessScore != null) {
            this.quietnessElement.textContent = `Quietness: ${vehicle.quietnessScore} / 100`;
        } else if (data.quietness != null) {
            this.quietnessElement.textContent = `Quietness: ${data.quietness} / 100`;
        } else {
            this.quietnessElement.textContent = 'Quietness: 走行中に算出';
        }
        this.updateNoiseHint();
        if (this.voiceFlag) {
            this.voiceFlag.hidden = !data.voiceDetected;
        }
        if (this.evLikelihoodElement && vehicle) {
            this.evLikelihoodElement.textContent =
                `EV-like: ${Math.round((vehicle.evLikelihood || 0) * 100)}% / ${this.engineStateLabel(vehicle.engineState)}`;
        }

        this.setIndependentNoise(vehicle);
        this.setBandMix(data);
        this.pushChart({
            dbfs: data.dbfs,
            quietness: vehicle && vehicle.quietnessScore != null ? vehicle.quietnessScore : data.quietness,
            voice: data.voiceDetected,
            calibrated: data.calibrated,
            engineDb: data.engineDb,
            roadDb: data.roadDb,
            windDb: data.windDb,
            engineShare: data.engineShare,
            roadShare: data.roadShare,
            windShare: data.windShare,
            engineNoiseScore: vehicle ? vehicle.engineNoiseScore : 0,
            roadNoiseScore: vehicle ? vehicle.roadNoiseScore : 0,
            windNoiseScore: vehicle ? vehicle.windNoiseScore : 0,
            dominant: data.dominant,
            engineState: vehicle ? vehicle.engineState : 'UNKNOWN'
        });
        this.updateScoreCards({ vehicle: vehicle });
        this.updateDebug(vehicle);
    }

    bandLabelText(key, db, share, calibrated) {
        const band = this.A.NOISE_BANDS[key];
        const value = typeof db === 'number' ? db : -100;
        const pct = Math.round((share || 0) * 100);
        const unit = calibrated ? 'dB' : 'dBFS';
        return `${band.label} ${pct}%\n${value.toFixed(1)} ${unit}\n${this.formatHz(band.low)}–${this.formatHz(band.high)}`;
    }

    formatHz(hz) {
        if (hz >= 1000) {
            const k = hz / 1000;
            return `${Number.isInteger(k) ? k : k}k`;
        }
        return String(hz);
    }

    setBandMix(data) {
        const engineShare = data.engineShare || 0;
        const roadShare = data.roadShare || 0;
        const windShare = data.windShare || 0;
        if (this.engineBar) {
            this.engineBar.style.width = `${(engineShare * 100).toFixed(1)}%`;
        }
        if (this.roadBar) {
            this.roadBar.style.width = `${(roadShare * 100).toFixed(1)}%`;
        }
        if (this.windBar) {
            this.windBar.style.width = `${(windShare * 100).toFixed(1)}%`;
        }
        if (this.engineLabel) {
            this.engineLabel.textContent = this.bandLabelText('engine', data.engineDb, engineShare, data.calibrated);
        }
        if (this.roadLabel) {
            this.roadLabel.textContent = this.bandLabelText('road', data.roadDb, roadShare, data.calibrated);
        }
        if (this.windLabel) {
            this.windLabel.textContent = this.bandLabelText('wind', data.windDb, windShare, data.calibrated);
        }
        if (this.noiseDominant) {
            const group = this.A.NOISE_DOMINANT_LABEL[data.dominant] || '--';
            const fine = this.A.NOISE_DOMINANT_LABEL[data.dominantFine] || '';
            this.noiseDominant.textContent = fine && fine !== group && data.dominantFine && data.dominantFine !== 'none'
                ? `主因: ${group}（${fine}）`
                : `主因: ${group}`;
        }
        this.A.FINE_BANDS.forEach((band) => {
            const share = data[band.key + 'Share'] || 0;
            const bar = this.fineBars[band.key];
            const label = this.fineLabels[band.key];
            if (bar) {
                bar.style.width = `${(share * 100).toFixed(1)}%`;
            }
            if (label) {
                label.textContent = this.fineLabelText(band, data[band.key + 'Db'], share, data.calibrated);
            }
        });
    }

    fineLabelText(band, db, share, calibrated) {
        const value = typeof db === 'number' ? db : -100;
        const pct = Math.round((share || 0) * 100);
        const unit = calibrated ? 'dB' : 'dBFS';
        return `${band.label} ${pct}%\n${value.toFixed(1)} ${unit}`;
    }

    modeLabel(id) {
        const found = this.A.DRIVE_MODES.find(function (mode) {
            return mode.id === id;
        });
        return found ? found.label : '未設定';
    }

    eventLabel(id) {
        const vehicleLabels = window.DriveVehicle && window.DriveVehicle.DRIVING_STATE_LABEL;
        if (vehicleLabels && vehicleLabels[id]) {
            return vehicleLabels[id];
        }
        return this.A.DRIVE_EVENT_LABEL[id] || '--';
    }

    engineStateLabel(id) {
        if (id === 'ENGINE_ON') {
            return 'ENGINE ON';
        }
        if (id === 'ENGINE_OFF') {
            return 'ENGINE OFF';
        }
        return 'UNKNOWN';
    }

    setIndependentNoise(vehicle) {
        if (!vehicle) {
            return;
        }
        const e = Math.round(vehicle.engineNoiseScore || 0);
        const r = Math.round(vehicle.roadNoiseScore || 0);
        const w = Math.round(vehicle.windNoiseScore || 0);
        if (this.noiseIndependent) {
            this.noiseIndependent.textContent = `Engine ${e} / Road ${r} / Wind ${w}`;
        }
        if (this.scoreEngineFill) {
            this.scoreEngineFill.style.width = `${e}%`;
        }
        if (this.scoreRoadFill) {
            this.scoreRoadFill.style.width = `${r}%`;
        }
        if (this.scoreWindFill) {
            this.scoreWindFill.style.width = `${w}%`;
        }
        if (this.scoreEngineLabel) {
            this.scoreEngineLabel.textContent = String(e);
        }
        if (this.scoreRoadLabel) {
            this.scoreRoadLabel.textContent = String(r);
        }
        if (this.scoreWindLabel) {
            this.scoreWindLabel.textContent = String(w);
        }
    }

    updateScoreCards(data) {
        const vehicle = data && data.vehicle
            ? data.vehicle
            : (this.sensorManager.vehicle ? this.sensorManager.vehicle.getSnapshot() : null);
        const quiet = data && data.quietnessScore != null
            ? data.quietnessScore
            : (vehicle && vehicle.quietnessScore);
        const ride = data && data.rideComfortScore != null
            ? data.rideComfortScore
            : (vehicle && vehicle.rideComfortScore);
        const pt = data && data.powertrainSmoothnessScore != null
            ? data.powertrainSmoothnessScore
            : (vehicle && vehicle.powertrainSmoothnessScore);
        if (this.scoreQuietness && quiet != null) {
            this.scoreQuietness.textContent = String(quiet);
        }
        if (this.scoreRide && ride != null) {
            this.scoreRide.textContent = String(ride);
        }
        if (this.scorePowertrain && pt != null) {
            this.scorePowertrain.textContent = String(pt);
        }
    }

    renderCharacter(data) {
        const character = data.character;
        if (character) {
            if (this.charLowShake) this.charLowShake.textContent = character.lowSpeedShake || '--';
            if (this.charCruise) this.charCruise.textContent = character.cruisingStability || '--';
            if (this.charPt) this.charPt.textContent = character.powertrainTransitions || '--';
            if (this.charRoad) this.charRoad.textContent = character.roadNoise || '--';
            if (this.charWind) this.charWind.textContent = character.windNoise || '--';
            if (this.charLowPt) this.charLowPt.textContent = character.lowSpeedPowertrain || '--';
        }
        if (this.driveComments) {
            this.driveComments.textContent = (data.comments && data.comments.length)
                ? data.comments.join('\n')
                : '特徴コメントを生成できる走行データが不足しています。';
        }
        this.updateScoreCards(data);
    }

    clearCharacter() {
        [this.charLowShake, this.charCruise, this.charPt, this.charRoad, this.charWind, this.charLowPt].forEach((el) => {
            if (el) {
                el.textContent = '--';
            }
        });
        if (this.driveComments) {
            this.driveComments.textContent = '計測中です。停止後に車両特性コメントを表示します。';
        }
        if (this.scoreQuietness) this.scoreQuietness.textContent = '--';
        if (this.scoreRide) this.scoreRide.textContent = '--';
        if (this.scorePowertrain) this.scorePowertrain.textContent = '--';
    }

    updateDebug(vehicle) {
        if (!this.debugMode || !this.debugPanel || !vehicle) {
            return;
        }
        this.debugPanel.textContent = JSON.stringify({
            engineProbability: vehicle.engineProbability,
            engineState: vehicle.engineState,
            drivingState: vehicle.drivingState,
            powertrainTransition: vehicle.powertrainTransition,
            gpsValid: vehicle.gpsValid,
            filteredSpeed: vehicle.filteredSpeed,
            factors: vehicle.engineFactors
        }, null, 2);
    }

    syncModeChips(id) {
        document.querySelectorAll('.mode-chip').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.mode === id);
        });
        if (this.driveModeElement) {
            this.driveModeElement.textContent = `モード: ${this.modeLabel(id)}`;
        }
    }

    addTrackPoint(point) {
        this.trackPoints.push(point);
        this.polyline.addLatLng([point.latitude, point.longitude]);
        this.tableEmpty.hidden = true;
        this.setExportEnabled(true);
        this.appendTableRow(point);

        this.updateScoreCards(point);
        if (this.engineStateElement) {
            this.engineStateElement.textContent =
                `パワートレーン: ${this.engineStateLabel(point.engineState)} / p=${Number(point.engineProbability || 0).toFixed(2)}`;
        }
        this.setIndependentNoise(point);
        this.updateDebug(point);

        if (this.shouldShowSpot(point)) {
            this.addSpot(point);
        }
    }

    shouldShowSpot(point) {
        if (point.index === 1) {
            return true;
        }
        const loud = !point.voice && (point.calibrated ? point.dbfs >= -12 : point.dbfs >= -18);
        if (point.vibKind === 'impact' || Math.abs(point.lateralG) >= 0.2 || point.shake >= 0.45 || loud) {
            return true;
        }
        const interval = this.trackPoints.length > 7200 ? 15 : this.trackPoints.length > 2400 ? 8 : 3;
        return point.index % interval === 0;
    }

    addSpot(point) {
        const color = this.spotColor(point);
        const circle = L.circleMarker([point.latitude, point.longitude], {
            radius: 5,
            color: '#222',
            weight: 1,
            fillColor: color,
            fillOpacity: 0.9
        });
        circle.bindPopup(this.spotPopup(point));
        circle.on('click', () => this.highlightRow(point.index));
        circle._trackIndex = point.index;
        this.spotLayer.addLayer(circle);
    }

    spotColor(point) {
        return this.colorMode === 'vib'
            ? (point.vibKind === 'impact' ? '#ff3b30' : this.A.vibrationColor(point.combinedRms))
            : this.A.noiseColor(point.dbfs, point.calibrated);
    }

    spotPopup(point) {
        return `
            <div class="spot-popup">
                <strong>${this.A.formatClock(new Date(point.time))}</strong><br>
                速度 ${point.speed.toFixed(1)} km/h<br>
                モード ${this.modeLabel(point.driveMode)} / ${this.eventLabel(point.drivingState || point.driveEvent)}<br>
                GPS ${point.gpsValid ? '有効' : '除外'} / 速度 ${Number(point.filteredSpeed != null ? point.filteredSpeed : point.speed).toFixed(1)} km/h<br>
                継続振動 ${Number(point.continuousVibration || point.combinedRms || 0).toFixed(2)} / Shake ${Number(point.shakeScore != null ? point.shakeScore : point.shake).toFixed(2)} / Impact ${Number(point.impactScore || 0).toFixed(0)}<br>
                Engine p ${Number(point.engineProbability || 0).toFixed(2)} / ${this.engineStateLabel(point.engineState)}<br>
                相対音量 ${point.dbfs.toFixed(1)} ${this.noiseUnit(point.calibrated)}<br>
                Q ${point.quietnessScore == null ? '--' : point.quietnessScore} / Ride ${point.rideComfortScore == null ? '--' : point.rideComfortScore} / PT ${point.powertrainSmoothnessScore == null ? '--' : point.powertrainSmoothnessScore}<br>
                Legacy エンジン ${Math.round((point.engineShare || 0) * 100)}% / ロード ${Math.round((point.roadShare || 0) * 100)}% / 風 ${Math.round((point.windShare || 0) * 100)}%
            </div>
        `;
    }

    redrawSpots() {
        this.spotLayer.clearLayers();
        this.trackPoints.forEach((point) => {
            if (this.shouldShowSpot(point)) {
                this.addSpot(point);
            }
        });
    }

    appendTableRow(point) {
        const tr = document.createElement('tr');
        tr.dataset.index = String(point.index);
        const shake = point.shakeScore != null ? point.shakeScore : point.shake;
        const vib = point.continuousVibration != null ? point.continuousVibration : point.combinedRms;
        const noiseTone = this.A.noiseColor(point.dbfs, point.calibrated);
        const shakeTone = this.A.lateralColor(shake);
        tr.innerHTML = `
            <td>${point.index}</td>
            <td>${this.A.formatClock(new Date(point.time))}</td>
            <td>${Number(point.filteredSpeed != null ? point.filteredSpeed : point.speed).toFixed(1)}</td>
            <td>${this.modeLabel(point.driveMode)}</td>
            <td>${this.eventLabel(point.drivingState || point.driveEvent)}</td>
            <td class="cell-metric" style="background:${shakeTone}">${Number(shake).toFixed(2)}</td>
            <td>${Number(vib).toFixed(2)}</td>
            <td class="cell-metric" style="background:${noiseTone}">${point.dbfs.toFixed(1)}</td>
            <td>${Number(point.engineProbability || 0).toFixed(2)}</td>
            <td>${point.quietnessScore == null ? '--' : point.quietnessScore}</td>
            <td>${point.rideComfortScore == null ? '--' : point.rideComfortScore}</td>
            <td>${point.powertrainSmoothnessScore == null ? '--' : point.powertrainSmoothnessScore}</td>
        `;
        this.tableBody.appendChild(tr);
        const maxRows = 400;
        while (this.tableBody.rows.length > maxRows) {
            this.tableBody.deleteRow(0);
        }
        if (this.tableScroll) {
            this.tableScroll.scrollTop = this.tableScroll.scrollHeight;
        }
    }

    setExportEnabled(enabled) {
        if (this.csvSaveButton) {
            this.csvSaveButton.disabled = !enabled;
        }
        if (this.csvMailButton) {
            this.csvMailButton.disabled = !enabled;
        }
    }

    csvFilename() {
        const started = this.sensorManager.getSessionSummary().startedAt;
        const stamp = this.A.formatStamp(started ? new Date(started) : new Date());
        return `driveanalytics-${stamp}.csv`;
    }

    buildCsvFile() {
        const points = this.sensorManager.getRecordedPoints();
        const summary = this.sensorManager.getSessionSummary();
        const csv = `\uFEFF${this.A.buildTrackCsv(summary, points)}`;
        const name = this.csvFilename();
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const file = new File([blob], name, { type: 'text/csv' });
        return { csv, name, blob, file, points, summary };
    }

    mailBody(summary, points) {
        const duration = this.A.formatDuration(summary.elapsedMs || 0);
        const km = ((summary.distanceM || 0) / 1000).toFixed(2);
        const avg = (summary.averageSpeed || 0).toFixed(1);
        const quiet = summary.quietnessScore != null ? summary.quietnessScore : summary.quietness;
        const ride = summary.rideComfortScore == null ? '--' : summary.rideComfortScore;
        const pt = summary.powertrainSmoothnessScore == null ? '--' : summary.powertrainSmoothnessScore;
        return [
            'DriveAnalytics 計測データです。',
            `計測時間: ${duration}`,
            `走行距離: ${km} km`,
            `平均速度: ${avg} km/h`,
            `Quietness: ${quiet == null ? '--' : quiet} / 100`,
            `Ride Comfort: ${ride} / 100`,
            `Powertrain Smoothness: ${pt} / 100`,
            `サンプル数: ${points.length}（1秒ごと）`
        ].join('\n');
    }

    downloadCsv() {
        const payload = this.buildCsvFile();
        if (!payload.points.length) {
            this.showStatus('送る計測データがありません。', true);
            return;
        }
        const url = URL.createObjectURL(payload.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = payload.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    async shareCsv() {
        const payload = this.buildCsvFile();
        if (!payload.points.length) {
            this.showStatus('送る計測データがありません。', true);
            return;
        }
        const text = this.mailBody(payload.summary, payload.points);
        const title = 'DriveAnalytics 計測データ';
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [payload.file] })) {
            try {
                await navigator.share({
                    files: [payload.file],
                    title: title,
                    text: text
                });
                return;
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    return;
                }
            }
        }
        this.downloadCsv();
        const mailto = `mailto:?subject=${encodeURIComponent(title + ' ' + payload.name)}&body=${encodeURIComponent(text + '\n\nCSVファイル「' + payload.name + '」を添付してください。')}`;
        window.location.href = mailto;
    }

    highlightRow(index) {
        this.selectedRowIndex = index;
        Array.from(this.tableBody.rows).forEach((row) => {
            row.classList.toggle('is-selected', Number(row.dataset.index) === index);
        });
        const selected = this.tableBody.querySelector(`tr[data-index="${index}"]`);
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    }

    focusPoint(index) {
        const point = this.trackPoints.find((item) => item.index === index);
        if (!point) {
            return;
        }
        this.followMap = false;
        this.map.setView([point.latitude, point.longitude], Math.max(this.map.getZoom(), 16));
        this.highlightRow(index);
        this.spotLayer.eachLayer((layer) => {
            if (layer._trackIndex === index && layer.openPopup) {
                layer.openPopup();
            }
        });
    }

    fitTrack() {
        if (this.trackPoints.length < 2) {
            return;
        }
        this.map.fitBounds(this.polyline.getBounds(), { padding: [28, 28] });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.uiManager = new UIManager(window.sensorManager);
});
