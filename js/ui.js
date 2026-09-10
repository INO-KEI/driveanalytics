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
        this.statusBanner = document.getElementById('status-banner');
        this.colorNoiseButton = document.getElementById('colorNoise');
        this.colorLateralButton = document.getElementById('colorLateral');

        this.initMap();
        this.initEventListeners();
        this.showCompatibility();
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
        this.statusBanner.hidden = !message;
        this.statusBanner.textContent = message || '';
        this.statusBanner.classList.toggle('is-error', Boolean(isError));
    }

    initMap() {
        this.map = L.map('map').setView([35.6895, 139.6917], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(this.map);
        this.spotLayer = L.layerGroup().addTo(this.map);
        this.polyline = L.polyline([], {
            color: '#1a73e8',
            weight: 4,
            opacity: 0.85
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

        this.tableBody.addEventListener('click', (event) => {
            const row = event.target.closest('tr');
            if (!row || !row.dataset.index) {
                return;
            }
            this.focusPoint(Number(row.dataset.index));
        });

        this.sensorManager.addDataListener(this.updateUI.bind(this));
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
        if (data.state === 'started') {
            this.resetTrack();
            this.showStatus(
                data.demo
                    ? 'デモ走行を表示しています。停止すると軌跡が残ります。'
                    : '計測中です。スマホは車内で固定してください。',
                false
            );
        }
        if (data.state === 'stopped') {
            this.showStatus('計測を停止しました。軌跡は地図と表に残しています。', false);
            this.fitTrack();
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
    }

    resetTrack() {
        this.trackPoints = [];
        this.selectedRowIndex = null;
        this.spotLayer.clearLayers();
        this.polyline.setLatLngs([]);
        this.tableBody.innerHTML = '';
        this.tableEmpty.hidden = false;
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
            this.marker = L.marker(latlng).addTo(this.map);
        }
        if (this.followMap) {
            this.map.panTo(latlng, { animate: true, duration: 0.4 });
        }
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
    }

    updateNoiseUI(data) {
        this.noiseLevelElement.textContent = `音圧: ${data.dbfs.toFixed(1)} dBFS（相対）`;
        if (data.quietness != null) {
            this.quietnessElement.textContent = `静粛性: ${data.quietness} / 100`;
        } else {
            this.quietnessElement.textContent = '静粛性: 走行中に算出';
        }

        this.setBand(this.engineBar, this.engineLabel, data.enginePct, 'エンジン');
        this.setBand(this.roadBar, this.roadLabel, data.roadPct, 'ロードノイズ');
        this.setBand(this.windBar, this.windLabel, data.windPct, '風切り音');
    }

    setBand(bar, label, pct, name) {
        const value = Math.round(pct || 0);
        bar.style.width = `${value}%`;
        label.textContent = `${name} ${value}%`;
    }

    addTrackPoint(point) {
        this.trackPoints.push(point);
        this.polyline.addLatLng([point.latitude, point.longitude]);
        this.tableEmpty.hidden = true;
        this.appendTableRow(point);

        if (this.shouldShowSpot(point)) {
            this.addSpot(point);
        }
    }

    shouldShowSpot(point) {
        if (point.index === 1) {
            return true;
        }
        if (Math.abs(point.lateralG) >= 0.2 || point.shake >= 0.45 || point.dbfs >= -18) {
            return true;
        }
        return point.index % 3 === 0;
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
            : this.A.noiseColor(point.dbfs);
    }

    spotPopup(point) {
        return `
            <div class="spot-popup">
                <strong>${this.A.formatClock(new Date(point.time))}</strong><br>
                速度 ${point.speed.toFixed(1)} km/h<br>
                横揺れ ${point.shake.toFixed(2)} m/s²<br>
                横G ${Math.abs(point.lateralG).toFixed(2)} G<br>
                音圧 ${point.dbfs.toFixed(1)} dBFS<br>
                エンジン ${Math.round(point.enginePct)}% /
                ロード ${Math.round(point.roadPct)}% /
                風 ${Math.round(point.windPct)}%<br>
                振動 ${point.comfort}
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
        const noiseTone = this.A.noiseColor(point.dbfs);
        const shakeTone = this.A.lateralColor(point.shake);
        tr.innerHTML = `
            <td>${point.index}</td>
            <td>${this.A.formatClock(new Date(point.time))}</td>
            <td>${point.speed.toFixed(1)}</td>
            <td class="cell-metric" style="background:${shakeTone}">${point.shake.toFixed(2)}</td>
            <td>${Math.abs(point.lateralG).toFixed(2)}</td>
            <td class="cell-metric" style="background:${noiseTone}">${point.dbfs.toFixed(1)}</td>
            <td>${Math.round(point.enginePct)}</td>
            <td>${Math.round(point.roadPct)}</td>
            <td>${Math.round(point.windPct)}</td>
            <td class="${point.comfortClass || ''}">${point.comfort}</td>
        `;
        this.tableBody.appendChild(tr);
        if (this.tableScroll) {
            this.tableScroll.scrollTop = this.tableScroll.scrollHeight;
        }
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
