'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const nodePath=require('node:path');
const root=nodePath.join(__dirname,'../..');
const read=file=>fs.readFileSync(nodePath.join(root,file),'utf8');

test('RuStore APK package and first public version stay consistent',()=>{
  const gradle=read('android/app/build.gradle.kts');
  assert.match(gradle,/applicationId = "ru\.echogame\.arena"/);
  assert.match(gradle,/minSdk = 26/);
  assert.match(gradle,/targetSdk = 35/);
  assert.match(gradle,/versionCode = 19/);
  assert.match(gradle,/versionName = "1\.0\.0"/);
  assert.match(gradle,/isDebuggable = false/);
});
test('release signing keys are referenced through environment variables only',()=>{
  const gradle=read('android/app/build.gradle.kts');
  for(const name of ['ECHO_RELEASE_KEYSTORE_PATH','ECHO_RELEASE_STORE_PASSWORD','ECHO_RELEASE_KEY_ALIAS','ECHO_RELEASE_KEY_PASSWORD']){
    assert.ok(gradle.includes('System.getenv("'+name+'")'),name);
  }
  assert.match(gradle,/signingConfig = signingConfigs\.getByName\("echoRuStoreRelease"\)/);
  assert.doesNotMatch(gradle,/storePassword = "\w{8,}"/);
  const ignore=read('android/.gitignore');
  assert.match(ignore,/\*\.jks/);
  assert.match(ignore,/\*\.p12/);
});
test('release workflow never runs on each APK branch push',()=>{
  const yaml=read('.github/workflows/android-release.yml');
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/tags:\s*\n\s*- 'echo-v\*'/);
  assert.doesNotMatch(yaml,/branches:\s*\n\s*- apk/);
  assert.match(yaml,/assembleRelease/);
  assert.match(yaml,/name='ru\.echogame\.arena'/);
  assert.match(yaml,/apksigner" verify --verbose --print-certs/);
  assert.match(yaml,/application-debuggable/);
  assert.match(yaml,/Upload verified signed APK/);
  for(const secret of ['ECHO_RELEASE_KEYSTORE_BASE64','ECHO_RELEASE_STORE_PASSWORD','ECHO_RELEASE_KEY_ALIAS','ECHO_RELEASE_KEY_PASSWORD','ECHO_VK_CLIENT_SECRET']){
    assert.ok(yaml.includes('secrets.'+secret),secret);
  }
});
test('debug APK workflow continues independently without release secrets',()=>{
  const yaml=read('.github/workflows/android-apk.yml');
  assert.match(yaml,/assembleDebug/);
  assert.doesNotMatch(yaml,/ECHO_RELEASE_STORE_PASSWORD/);
});
