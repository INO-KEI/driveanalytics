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