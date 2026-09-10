// app.js
document.addEventListener('DOMContentLoaded', () => {
    checkPermissions();
    const warnings = checkCompatibility();
    if (warnings.length) {
        warnings.forEach((message) => log(message));
    }
});

async function checkPermissions() {
    try {
        if (navigator.permissions) {
            const geolocationStatus = await navigator.permissions.query({ name: 'geolocation' });
            log('Geolocation permission: ' + geolocationStatus.state);
        }
    } catch (error) {
        console.error('Error checking permissions:', error);
    }
}

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

    if (!window.isSecureContext) {
        warnings.push('センサー利用には HTTPS（または localhost）が必要です。');
    }

    return warnings;
}

function log(message) {
    console.log(`[DriveAnalytics] ${message}`);
}
