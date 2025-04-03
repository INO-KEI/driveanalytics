# DriveAnalytics 開発手順書

## 1. 開発環境セットアップ

### 1.1 必要なツール
- コードエディタ（VSCode推奨）
- ウェブサーバー（開発用）
- Git（バージョン管理用）
- モダンブラウザ（Chrome, Firefox）
- モバイルデバイス（テスト用）

### 1.2 プロジェクト初期化
```bash
# プロジェクトディレクトリ作成
mkdir driveanalytics
cd driveanalytics

# Gitリポジトリ初期化
git init

# 基本ディレクトリ構造作成
mkdir -p css js images
```

## 2. PWA基盤構築

### 2.1 HTMLベース作成
```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#4285f4">
    <title>DriveAnalytics</title>
    <link rel="stylesheet" href="css/style.css">
    <link rel="manifest" href="manifest.json">
</head>
<body>
    <!-- アプリUI構造 -->
    <div class="app-container">
        <header>
            <h1>DriveAnalytics</h1>
        </header>
        
        <main>
            <div id="controls">
                <button id="startButton">計測開始</button>
                <button id="stopButton" disabled>計測停止</button>
            </div>
            
            <div id="data-display">
                <div id="map"></div>
                <div id="sensors">
                    <div class="sensor-box" id="location-data">
                        <h3>位置情報</h3>
                        <div id="coordinates">緯度: -- 経度: --</div>
                        <div id="speed">速度: -- km/h</div>
                    </div>
                    <div class="sensor-box" id="vibration-data">
                        <h3>振動レベル</h3>
                        <div id="acceleration">X: -- Y: -- Z: --</div>
                        <div id="vibration-level">レベル: --</div>
                    </div>
                    <div class="sensor-box" id="noise-data">
                        <h3>ノイズレベル</h3>
                        <div id="noise-level">-- dB</div>
                    </div>
                </div>
                <div id="data-log">
                    <h3>データログ</h3>
                    <div id="log-content"></div>
                </div>
            </div>
        </main>
    </div>

    <!-- スクリプト -->
    <script src="https://unpkg.com/leaflet@1.7.1/dist/leaflet.js"></script>
    <script src="js/app.js"></script>
    <script src="js/sensors.js"></script>
    <script src="js/ui.js"></script>
    <script>
        // Service Workerの登録
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
            .then(function(registration) {
                console.log('Service Worker登録成功:', registration.scope);
            })
            .catch(function(error) {
                console.log('Service Worker登録失敗:', error);
            });
        }
    </script>
</body>
</html>
```

### 2.2 CSSスタイル作成
```css
/* style.css */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    line-height: 1.6;
    color: #333;
    background-color: #f5f5f5;
}

.app-container {
    max-width: 100%;
    margin: 0 auto;
    padding: 1rem;
}

header {
    background-color: #4285f4;
    color: white;
    padding: 1rem;
    text-align: center;
    margin-bottom: 1rem;
    border-radius: 8px;
}

button {
    background-color: #4285f4;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    margin: 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
}

button:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
}

#map {
    height: 300px;
    margin-bottom: 1rem;
    border-radius: 8px;
    overflow: hidden;
}

#sensors {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1rem;
}

.sensor-box {
    flex: 1 1 200px;
    background-color: white;
    padding: 1rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

#data-log {
    background-color: white;
    padding: 1rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    max-height: 200px;
    overflow-y: auto;
}

#log-content {
    font-family: monospace;
    font-size: 0.9rem;
}

@media (max-width: 768px) {
    #sensors {
        flex-direction: column;
    }
    
    .sensor-box {
        flex: 1 1 auto;
    }
}
```

### 2.3 マニフェストファイル作成
```json
{
    "name": "DriveAnalytics",
    "short_name": "DriveAnalytics",
    "description": "車両の乗り心地を評価するアプリ",
    "start_url": "/index.html",
    "display": "standalone",
    "background_color": "#ffffff",
    "theme_color": "#4285f4",
    "icons": [
        {
            "src": "images/icon-192.png",
            "sizes": "192x192",
            "type": "image/png"
        },
        {
            "src": "images/icon-512.png",
            "sizes": "512x512",
            "type": "image/png"
        }
    ]
}
```

### 2.4 Service Worker作成
```javascript
// sw.js
const CACHE_NAME = 'drive-analytics-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/sensors.js',
    '/js/ui.js',
    '/images/icon-192.png',
    '/images/icon-512.png',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css'
];

// インストール時のキャッシュ
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(urlsToCache);
        })
    );
});

// キャッシュからのレスポンス
self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request).then(function(response) {
            if (response) {
                return response;
            }
            return fetch(event.request);
        })
    );
});
```

## 3. センサー機能実装

### 3.1 センサー処理モジュール
```javascript
// sensors.js
class SensorManager {
    constructor() {
        this.isRecording = false;
        this.locationData = {
            latitude: null,
            longitude: null,
            speed: null
        };
        this.accelerationData = {
            x: 0,
            y: 0,
            z: 0
        };
        this.noiseLevel = 0;
        
        this.locationWatchId = null;
        this.audioContext = null;
        this.analyzer = null;
        this.microphone = null;
        
        this.dataListeners = [];
    }
    
    // 位置情報の取得開始
    startLocationTracking() {
        if (navigator.geolocation) {
            const options = {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            };
            
            this.locationWatchId = navigator.geolocation.watchPosition(
                this.handleLocationUpdate.bind(this),
                this.handleLocationError.bind(this),
                options
            );
        } else {
            console.error('Geolocation is not supported by this browser.');
        }
    }
    
    // 位置情報更新ハンドラ
    handleLocationUpdate(position) {
        this.locationData.latitude = position.coords.latitude;
        this.locationData.longitude = position.coords.longitude;
        this.locationData.speed = position.coords.speed ? position.coords.speed * 3.6 : 0; // m/s から km/h へ変換
        
        this.notifyListeners('location', this.locationData);
    }
    
    // 位置情報エラーハンドラ
    handleLocationError(error) {
        console.error('Error getting location:', error.message);
    }
    
    // 位置情報の取得停止
    stopLocationTracking() {
        if (this.locationWatchId !== null) {
            navigator.geolocation.clearWatch(this.locationWatchId);
            this.locationWatchId = null;
        }
    }
    
    // 加速度センサーの開始
    startAccelerationTracking() {
        if (window.DeviceMotionEvent) {
            window.addEventListener('devicemotion', this.handleMotionEvent.bind(this));
        } else {
            console.error('Device motion is not supported by this browser.');
        }
    }
    
    // 加速度センサーイベントハンドラ
    handleMotionEvent(event) {
        if (!this.isRecording) return;
        
        const acceleration = event.accelerationIncludingGravity;
        if (!acceleration) return;
        
        this.accelerationData.x = acceleration.x || 0;
        this.accelerationData.y = acceleration.y || 0;
        this.accelerationData.z = acceleration.z || 0;
        
        // 振動の強さを計算（単純な合計値）
        const magnitude = Math.sqrt(
            Math.pow(this.accelerationData.x, 2) +
            Math.pow(this.accelerationData.y, 2) +
            Math.pow(this.accelerationData.z, 2)
        );
        
        this.accelerationData.magnitude = magnitude;
        this.notifyListeners('acceleration', this.accelerationData);
    }
    
    // 加速度センサーの停止
    stopAccelerationTracking() {
        window.removeEventListener('devicemotion', this.handleMotionEvent.bind(this));
    }
    
    // マイク使用の開始
    async startNoiseTracking() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('getUserMedia is not supported by this browser.');
            }
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyzer = this.audioContext.createAnalyser();
            this.analyzer.fftSize = 256;
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyzer);
            
            // アナライザーからデータの取得を開始
            this.processNoiseData();
        } catch (error) {
            console.error('Error accessing microphone:', error);
        }
    }
    
    // ノイズ処理
    processNoiseData() {
        if (!this.isRecording || !this.analyzer) return;
        
        const dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
        this.analyzer.getByteFrequencyData(dataArray);
        
        // 平均音量レベルの計算
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // 0-255の範囲から大まかなdB値へ変換（近似値）
        this.noiseLevel = Math.round((average / 255) * 100);
        
        this.notifyListeners('noise', { level: this.noiseLevel });
        
        // 継続的に処理
        requestAnimationFrame(this.processNoiseData.bind(this));
    }
    
    // マイク使用の停止
    stopNoiseTracking() {
        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.analyzer = null;
    }
    
    // 全センサーの開始
    startRecording() {
        this.isRecording = true;
        this.startLocationTracking();
        this.startAccelerationTracking();
        this.startNoiseTracking();
    }
    
    // 全センサーの停止
    stopRecording() {
        this.isRecording = false;
        this.stopLocationTracking();
        this.stopAccelerationTracking();
        this.stopNoiseTracking();
    }
    
    // データ更新リスナー追加
    addDataListener(callback) {
        this.dataListeners.push(callback);
    }
    
    // リスナーへの通知
    notifyListeners(type, data) {
        if (!this.isRecording) return;
        
        this.dataListeners.forEach(callback => {
            callback(type, data);
        });
    }
}

// エクスポート
window.sensorManager = new SensorManager();
```

### 3.2 UI処理モジュール
```javascript
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
```

### 3.3 メインアプリケーションファイル
```javascript
// app.js
document.addEventListener('DOMContentLoaded', () => {
    // センサーアクセス許可の確認
    checkPermissions();
});

// 必要な権限の確認
async function checkPermissions() {
    try {
        // 位置情報の権限確認
        if (navigator.permissions) {
            const geolocationStatus = await navigator.permissions.query({ name: 'geolocation' });
            console.log('Geolocation permission:', geolocationStatus.state);
        }
        
        // マイクの権限確認（直接確認は難しいので、必要時に要求）
        console.log('Microphone permissions will be requested when recording starts');
        
    } catch (error) {
        console.error('Error checking permissions:', error);
    }
}

// ブラウザの互換性チェック
function checkCompatibility() {
    const warnings = [];
    
    if (!navigator.geolocation) {
        warnings.push('お使いのブラウザは位置情報をサポートしていません。');
    }
    
    if (!window.DeviceMotionEvent) {
        warnings.push('お使いのブラウザは加速度センサーをサポートしていません。');
    }
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        warnings.push('お使いのブラウザはマイク入力をサポートしていません。');
    }
    
    return warnings;
}

// デバッグ用ログ
function log(message) {
    console.log(`[DriveAnalytics] ${message}`);
}
```

## 4. PWAの機能拡張

### 4.1 アプリアイコンの作成
- 192x192と512x512サイズのアイコンを作成
- `images`ディレクトリに配置

### 4.2 オフラインサポートの強化
- キャッシュ戦略の最適化
- オフライン時のユーザー通知

## 5. テスト手順

### 5.1 開発環境でのテスト
1. ローカルサーバーを起動
```bash
# 例: Node.jsのhttpサーバー
npx http-server -c-1
```

2. ブラウザでアプリにアクセス（http://localhost:8080）
3. 開発者ツールでデバイスエミュレーションを有効化
4. センサーデータの表示をチェック

### 5.2 実機テスト
1. スマートフォンをUSBでPCに接続
2. リモートデバッグを有効化
3. 車両内でのテスト走行実施
4. データ収集と表示をチェック

## 6. デプロイ手順

### 6.1 ホスティングサービスへのデプロイ
1. HTTPS対応のウェブサーバーを選択（センサーAPIはHTTPS必須）
2. ファイルのアップロード
3. マニフェストとService Workerのパスを確認

### 6.2 動作確認
1. スマートフォンからアクセス
2. ホーム画面への追加テスト
3. オフラインモードでの動作確認 