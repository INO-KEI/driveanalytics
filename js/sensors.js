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
            // iOS 13+用の許可要求
            if (typeof DeviceMotionEvent.requestPermission === 'function') {
                console.log('iOS 13+ デバイスを検出: 加速度センサー許可が必要です');
                DeviceMotionEvent.requestPermission()
                    .then(permissionState => {
                        if (permissionState === 'granted') {
                            console.log('加速度センサー許可が付与されました');
                            window.addEventListener('devicemotion', this.handleMotionEvent.bind(this));
                        } else {
                            console.error('加速度センサー許可が拒否されました:', permissionState);
                        }
                    })
                    .catch(console.error);
            } else {
                // iOS 13以前またはAndroidなど、許可が必要ないデバイス
                console.log('標準デバイスを検出: 加速度センサーイベントを登録します');
                window.addEventListener('devicemotion', this.handleMotionEvent.bind(this));
            }
        } else {
            console.error('Device motion is not supported by this browser.');
        }
    }
    
    // 加速度センサーイベントハンドラ
    handleMotionEvent(event) {
        if (!this.isRecording) return;
        
        const acceleration = event.accelerationIncludingGravity;
        if (!acceleration) {
            console.error('加速度データが取得できません:', event);
            return;
        }
        
        // デバッグログ
        console.log('加速度データ:', acceleration);
        
        this.accelerationData.x = acceleration.x || 0;
        this.accelerationData.y = acceleration.y || 0;
        this.accelerationData.z = acceleration.z || 0;
        
        // 振動の強さを計算（単純な合計値）
        const magnitude = Math.sqrt(
            Math.pow(this.accelerationData.x, 2) +
            Math.pow(this.accelerationData.y, 2) +
            Math.pow(this.accelerationData.z, 2)
        );
        
        console.log('振動強度:', magnitude);
        
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