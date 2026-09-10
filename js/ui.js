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
        this.avgSpeedElement = document.getElementById('average-speed');
        this.distanceElement = document.getElementById('distance');
        this.durationElement = document.getElementById('duration');
        this.accelerationElement = document.getElementById('acceleration');
        this.vibrationLevelElement = document.getElementById('vibration-level');
        this.vibrationFreqElement = document.getElementById('vibration-freq');
        this.comfortElement = document.getElementById('comfort');
        this.lateralElement = document.getElementById('lateral-g');
        this.shakeElement = document.getElementById('lateral-shake');
        this.noiseLevelElement = document.getElementById('noise-level');
        this.quietnessElement = document.getElementById('quietness');
        this.engineBar = document.getElementById('band-engine');
        this.roadBar = document.getElementById('band-road');
        this.windBar = document.getElementById('band-wind');
        this.engineLabel = document.getElementById('band-engine-label');
        this.roadLabel = document.getElementById('band-road-label');
        this.windLabel = document.getElementById('band-wind-label');
        this.tableBody = document.getElementById('track-table-body');
        this.tableScroll = document.querySelector('.table-scroll');
        this.tableEmpty = document.getElementById('track-empty');
        this.csvSaveButton = document.getElementById('csvSave');
        this.csvMailButton = document.getElementById('csvMail');
        this.statusBanner = document.getElementById('status-banner');
        this.colorNoiseButton = document.getElementById('colorNoise');
        this.colorLateralButton = document.getElementById('colorLateral');
        this.noiseHint = document.getElementById('noise-hint');
        this.voiceFlag = document.getElementById('voice-flag');
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
            weight: 4,
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
        this.colorLateralButton.addEventListener('click', () => this.setColorMode('lateral'));
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
            ? 'カスタネット基準です。0 dB は校正音と同じ大きさです。'
            : '未校正です。同一端末での車種比較向けです。';
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
        return calibrated ? 'dB（校正基準比）' : 'dBFS（相対）';
    }

    setColorMode(mode) {
        this.colorMode = mode;
        this.colorNoiseButton.classList.toggle('is-active', mode === 'noise');
        this.colorLateralButton.classList.toggle('is-active', mode === 'lateral');
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
        if (this.quietnessElement && data.quietness != null) {
            this.quietnessElement.textContent = `静粛性: ${data.quietness} / 100`;
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
        if (this.marker) {
            this.map.removeLayer(this.marker);
            this.marker = null;
        }
    }

    updateLocationUI(data) {
        this.coordinatesElement.textContent =
            `緯度: ${data.latitude.toFixed(6)} 経度: ${data.longitude.toFixed(6)}`;
        this.speedElement.textContent = `速度: ${(data.speed || 0).toFixed(1)} km/h`;
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
            this.marker = L.circleMarker(latlng, {
                radius: 7,
                color: '#ff7a18',
                weight: 2,
                fillColor: '#39ff50',
                fillOpacity: 0.95
            }).addTo(this.map);
        }
        if (this.followMap) {
            this.map.panTo(latlng, { animate: true, duration: 0.4 });
        }
        this.pushChart({ speed: data.speed || 0 });
    }

    updateAccelerationUI(data) {
        this.accelerationElement.textContent =
            `上下: ${data.vertical.toFixed(2)} 横揺れ: ${data.horizontal.toFixed(2)} m/s²`;

        const hasSignal = Math.abs(data.vertical) > 0.01 || Math.abs(data.horizontal) > 0.01 || data.rms > 0.01;
        if (!hasSignal && data.x === 0 && data.y === 0 && data.z === 0) {
            this.vibrationLevelElement.textContent = '振幅: 計測不能';
            this.vibrationLevelElement.className = 'level-error';
            this.comfortElement.textContent = '判定: 計測不能';
            this.comfortElement.className = 'level-error';
            return;
        }

        this.vibrationLevelElement.textContent =
            `振幅 RMS: ${(data.rms || 0).toFixed(2)} m/s²（振れ幅 ${(data.peak || 0).toFixed(2)}）`;
        this.vibrationLevelElement.className = data.comfortClass || '';
        this.vibrationFreqElement.textContent = `卓越周波数: ${(data.freq || 0).toFixed(1)} Hz`;
        this.comfortElement.textContent = `判定: ${data.comfort}`;
        this.comfortElement.className = data.comfortClass || '';
        this.lateralElement.textContent = `横G（コーナリング）: ${Math.abs(data.lateralG || 0).toFixed(2)} G`;
        this.shakeElement.textContent = `横揺れ: ${(data.shake || 0).toFixed(2)} m/s²`;
        this.pushChart({
            rms: data.rms || 0,
            shake: data.shake || 0,
            lateralG: data.lateralG || 0
        });
    }

    updateNoiseUI(data) {
        const unit = this.noiseUnit(data.calibrated);
        this.noiseLevelElement.textContent = `音圧: ${data.dbfs.toFixed(1)} ${unit}`;
        if (data.quietness != null) {
            this.quietnessElement.textContent = `静粛性: ${data.quietness} / 100`;
        } else {
            this.quietnessElement.textContent = '静粛性: 走行中に算出';
        }
        this.updateNoiseHint();
        if (this.voiceFlag) {
            this.voiceFlag.hidden = !data.voiceDetected;
        }

        this.setBandDb(this.engineBar, this.engineLabel, data.engineDb, 'エンジン', data.calibrated);
        this.setBandDb(this.roadBar, this.roadLabel, data.roadDb, 'ロードノイズ', data.calibrated);
        this.setBandDb(this.windBar, this.windLabel, data.windDb, '風切り音', data.calibrated);
        this.pushChart({
            dbfs: data.dbfs,
            quietness: data.quietness,
            voice: data.voiceDetected,
            calibrated: data.calibrated
        });
    }

    setBandDb(bar, label, db, name, calibrated) {
        const value = typeof db === 'number' ? db : -100;
        const unit = calibrated ? 'dB' : 'dBFS';
        label.textContent = `${name} ${value.toFixed(1)} ${unit}`;
        const t = calibrated ? (value + 40) / 40 : (value + 60) / 60;
        bar.style.width = `${Math.round(this.A.clamp(t, 0, 1) * 100)}%`;
    }

    addTrackPoint(point) {
        this.trackPoints.push(point);
        this.polyline.addLatLng([point.latitude, point.longitude]);
        this.tableEmpty.hidden = true;
        this.setExportEnabled(true);
        this.appendTableRow(point);

        if (this.shouldShowSpot(point)) {
            this.addSpot(point);
        }
    }

    shouldShowSpot(point) {
        if (point.index === 1) {
            return true;
        }
        const loud = !point.voice && (point.calibrated ? point.dbfs >= -12 : point.dbfs >= -18);
        if (Math.abs(point.lateralG) >= 0.2 || point.shake >= 0.45 || loud) {
            return true;
        }
        const interval = this.trackPoints.length > 7200 ? 15 : this.trackPoints.length > 2400 ? 8 : 3;
        return point.index % interval === 0;
    }

    addSpot(point) {
        const color = this.spotColor(point);
        const circle = L.circleMarker([point.latitude, point.longitude], {
            radius: 8,
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
        return this.colorMode === 'lateral'
            ? this.A.lateralColor(point.shake)
            : this.A.noiseColor(point.dbfs, point.calibrated);
    }

    spotPopup(point) {
        return `
            <div class="spot-popup">
                <strong>${this.A.formatClock(new Date(point.time))}</strong><br>
                速度 ${point.speed.toFixed(1)} km/h<br>
                横揺れ ${point.shake.toFixed(2)} m/s²<br>
                横G ${Math.abs(point.lateralG).toFixed(2)} G<br>
                音圧 ${point.dbfs.toFixed(1)} ${this.noiseUnit(point.calibrated)}<br>
                エンジン ${point.engineDb.toFixed(1)} /
                ロード ${point.roadDb.toFixed(1)} /
                風 ${point.windDb.toFixed(1)} ${this.noiseUnit(point.calibrated)}<br>
                振動 ${point.comfort}${point.voice ? '<br>ナビ/会話のため除外' : ''}
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
        const noiseTone = this.A.noiseColor(point.dbfs, point.calibrated);
        const shakeTone = this.A.lateralColor(point.shake);
        tr.innerHTML = `
            <td>${point.index}</td>
            <td>${this.A.formatClock(new Date(point.time))}</td>
            <td>${point.speed.toFixed(1)}</td>
            <td class="cell-metric" style="background:${shakeTone}">${point.shake.toFixed(2)}</td>
            <td>${Math.abs(point.lateralG).toFixed(2)}</td>
            <td class="cell-metric" style="background:${noiseTone}">${point.dbfs.toFixed(1)}</td>
            <td class="cell-metric" style="background:${this.A.noiseColor(point.engineDb, point.calibrated)}">${point.engineDb.toFixed(1)}</td>
            <td class="cell-metric" style="background:${this.A.noiseColor(point.roadDb, point.calibrated)}">${point.roadDb.toFixed(1)}</td>
            <td class="cell-metric" style="background:${this.A.noiseColor(point.windDb, point.calibrated)}">${point.windDb.toFixed(1)}</td>
            <td class="${point.comfortClass || ''}">${point.voice ? '音声除外' : point.comfort}</td>
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
        const quiet = summary.quietness == null ? '--' : summary.quietness;
        return [
            'DriveAnalytics 計測データです。',
            `計測時間: ${duration}`,
            `走行距離: ${km} km`,
            `平均速度: ${avg} km/h`,
            `静粛性: ${quiet} / 100`,
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
