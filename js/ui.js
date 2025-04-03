// ui.js
class UIManager {
    constructor(sensorManager) {
        this.sensorManager = sensorManager;
        this.map = null;
        this.marker = null;
        this.logEntries = [];
        this.maxLogEntries = 20;
        
        // UI要素
        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.coordinatesElement = document.getElementById('coordinates');
        this.speedElement = document.getElementById('speed');
        this.accelerationElement = document.getElementById('acceleration');
        this.vibrationLevelElement = document.getElementById('vibration-level');
        this.noiseLevelElement = document.getElementById('noise-level');
        this.logContentElement = document.getElementById('log-content');
        
        this.initMap();
        this.initEventListeners();
    }
    
    // 地図の初期化
    initMap() {
        this.map = L.map('map').setView([35.6895, 139.6917], 13); // 東京を中心に表示
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(this.map);
    }
    
    // イベントリスナーの初期化
    initEventListeners() {
        this.startButton.addEventListener('click', () => {
            this.sensorManager.startRecording();
            this.startButton.disabled = true;
            this.stopButton.disabled = false;
            this.addLogEntry('計測開始');
        });
        
        this.stopButton.addEventListener('click', () => {
            this.sensorManager.stopRecording();
            this.startButton.disabled = false;
            this.stopButton.disabled = true;
            this.addLogEntry('計測停止');
        });
        
        // センサーデータのリスナー追加
        this.sensorManager.addDataListener(this.updateUI.bind(this));
    }
    
    // UIの更新
    updateUI(type, data) {
        switch(type) {
            case 'location':
                this.updateLocationUI(data);
                break;
            case 'acceleration':
                this.updateAccelerationUI(data);
                break;
            case 'noise':
                this.updateNoiseUI(data);
                break;
        }
    }
    
    // 位置情報UI更新
    updateLocationUI(data) {
        this.coordinatesElement.textContent = `緯度: ${data.latitude.toFixed(6)} 経度: ${data.longitude.toFixed(6)}`;
        this.speedElement.textContent = `速度: ${data.speed ? data.speed.toFixed(1) : 0} km/h`;
        
        // 地図の更新
        if (this.marker) {
            this.marker.setLatLng([data.latitude, data.longitude]);
        } else {
            this.marker = L.marker([data.latitude, data.longitude]).addTo(this.map);
        }
        
        this.map.setView([data.latitude, data.longitude]);
        this.addLogEntry(`位置: ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}, 速度: ${data.speed ? data.speed.toFixed(1) : 0} km/h`);
    }
    
    // 加速度UI更新
    updateAccelerationUI(data) {
        this.accelerationElement.textContent = `X: ${data.x.toFixed(2)}, Y: ${data.y.toFixed(2)}, Z: ${data.z.toFixed(2)}`;
        
        // 振動レベルの表示（簡易版）
        let level = '低';
        let magnitude = data.magnitude || 0;
        
        if (magnitude > 15) {
            level = '高';
        } else if (magnitude > 10) {
            level = '中';
        }
        
        this.vibrationLevelElement.textContent = `レベル: ${level} (${magnitude.toFixed(2)})`;
        this.addLogEntry(`振動: ${level} (${magnitude.toFixed(2)})`);
    }
    
    // ノイズUI更新
    updateNoiseUI(data) {
        this.noiseLevelElement.textContent = `${data.level} dB (推定値)`;
        this.addLogEntry(`ノイズ: ${data.level} dB`);
    }
    
    // ログエントリー追加
    addLogEntry(message) {
        const now = new Date();
        const timeStr = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
        const entry = `${timeStr} - ${message}`;
        
        this.logEntries.unshift(entry);
        
        // 最大エントリー数を制限
        if (this.logEntries.length > this.maxLogEntries) {
            this.logEntries.pop();
        }
        
        // ログ表示の更新
        this.logContentElement.innerHTML = this.logEntries.join('<br>');
    }
}

// アプリ初期化
document.addEventListener('DOMContentLoaded', () => {
    window.uiManager = new UIManager(window.sensorManager);
}); 