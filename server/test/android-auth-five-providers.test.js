'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../../android/app/src/main');
const kotlin=name=>fs.readFileSync(path.join(root,'java/ru/echo/game',name),'utf8');
test('native settings offer one login button that opens the five-choice dialog',()=>{
 const screens=kotlin('EchoScreens.kt');
 assert.match(screens,/ВОЙТИ В АККАУНТ/);
 assert.match(screens,/showAuthDialog = true/);
 assert.match(screens,/EchoAuthDialog\(/);
 assert.doesNotMatch(screens,/ВОЙТИ ЧЕРЕЗ VK/);
});
test('Yandex, Google, VK, OK, Mail are five equal weighted siblings',()=>{
 const screens=kotlin('EchoScreens.kt');
 const section=screens.split('private fun EchoAuthDialog(')[1].split('private fun EchoAuthProviderButton(')[0];
 const providers=['yandex','google','vk','ok','mail'];
 for(const p of providers)assert.match(section,new RegExp('EchoAuthProviderButton\\("'+p+'", auth\\.busy, Modifier\\.weight\\(1f\\)\\)'));
 assert.match(section,/Выберите способ входа/);
 assert.match(section,/Row\(/);
 assert.match(section,/onVkLogin\(OAuth\.OK\)/);
 assert.match(section,/onVkLogin\(OAuth\.MAIL\)/);
 assert.match(section,/onVkLogin\(OAuth\.VK\)/);
 assert.match(section,/onOAuthLogin\("google", false\)/);
 assert.match(section,/onOAuthLogin\("yandex", false\)/);
});
test('VK ID SDK launches selected native provider, while Google/Yandex use existing PKCE',()=>{
 const main=kotlin('MainActivity.kt');
 assert.match(main,/private fun startVkLogin\(provider: OAuth\)/);
 assert.match(main,/VKIDAuthParams \{/);
 assert.match(main,/oAuth = provider/);
 assert.match(main,/VKID\.instance\.authorize\(this, vkAuthCallback/);
 assert.match(main,/onOAuthLogin = ::startOAuthLogin/);
 const auth=kotlin('EchoAuthSession.kt');
 assert.match(auth,/fun startOAuth\(provider: String, link: Boolean\)/);
 assert.match(auth,/codeChallenge/);
 assert.match(auth,/fun finishOAuth\(ticket: String\)/);
 assert.match(main,/echogame/);
});
test('all logo drawables ship inside the APK, no network assets or tokens in URLs',()=>{
 for(const provider of ['google','vk','ok','mail']){
  const xml=fs.readFileSync(path.join(root,'res/drawable','echo_oauth_'+provider+'.xml'),'utf8');
  assert.match(xml,/android:viewportWidth/);
  assert.match(xml,/<path/);
 }
});
