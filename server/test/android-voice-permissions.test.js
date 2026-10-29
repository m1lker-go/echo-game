'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'android/app/src/main/java/ru/echo/game/EchoWebActivity.kt'), 'utf8');

test('APK declares microphone permission without camera or background recording', () => {
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.doesNotMatch(manifest, /android\.permission\.CAMERA/);
  assert.doesNotMatch(manifest, /FOREGROUND_SERVICE_MICROPHONE/);
});

test('WebView microphone requires the ECHO arena and exact HTTPS origin', () => {
  assert.match(activity, /private fun canGrantVoiceMicrophone\(request: PermissionRequest\)/);
  assert.match(activity, /page != Page\.ARENA/);
  assert.match(activity, /uri\.scheme\.equals\("https", ignoreCase = true\)/);
  assert.match(activity, /uri\.host\.equals\("cat-fight\.ru", ignoreCase = true\)/);
  assert.match(activity, /currentPath != "\/echo"/);
  assert.match(activity, /request\.resources\.contentEquals\(arrayOf\(PermissionRequest\.RESOURCE_AUDIO_CAPTURE\)\)/);
  assert.doesNotMatch(activity, /request\.grant\(request\.resources\)/);
});

test('grant microphone only after Android runtime permission and clean up canceled requests', () => {
  assert.match(activity, /override fun onPermissionRequest\(request: PermissionRequest\)/);
  assert.match(activity, /if \(!canGrantVoiceMicrophone\(request\)\)/);
  assert.match(activity, /ActivityResultContracts\.RequestPermission\(\)/);
  assert.match(activity, /ContextCompat\.checkSelfPermission\(/);
  assert.match(activity, /Manifest\.permission\.RECORD_AUDIO/);
  assert.match(activity, /microphonePermissionLauncher\.launch\(Manifest\.permission\.RECORD_AUDIO\)/);
  assert.match(activity, /if \(granted && canGrantVoiceMicrophone\(request\)\)/);
  assert.match(activity, /request\.grant\(arrayOf\(PermissionRequest\.RESOURCE_AUDIO_CAPTURE\)\)/);
  assert.match(activity, /override fun onPermissionRequestCanceled\(request: PermissionRequest\)/);
  assert.match(activity, /clearPendingVoiceMicrophone\(\)/);
});