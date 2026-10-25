'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const client=path.join(__dirname,'../../client');
const read=file=>fs.readFileSync(path.join(client,file),'utf8');
test('Google and Yandex choices are visible outside VK Mini Apps even before OAuth configuration',()=>{
 const code=read('auth-ui.js');
 assert.match(code,/button\.hidden=isVKMiniApp;/);
 assert.doesNotMatch(code,/button\.hidden=!enabled\|\|isVKMiniApp/);
 assert.match(code,/oauthMethods\.append\(oauthButton\('yandex',false\),oauthButton\('google',false\)\)/);
 assert.match(code,/button\.dataset\.configured=String\(ready\)/);
 assert.match(code,/startOAuth\(provider,link\)/);
});
test('ECHO OAuth login buttons have styles within the body-level modal portal',()=>{
 const css=read('auth.css');
 assert.match(css,/\.echo-modal-overlay \.echo-oauth-methods\{/);
 assert.match(css,/\.echo-modal-overlay \.echo-oauth-button/);
 assert.match(css,/\.echo-vk-mini-app \.echo-oauth-button\{display:none!important\}/);
});
test('browser refreshes OAuth client assets after the visibility fix',()=>{
 const page=read('index.html');
 assert.match(page,/auth-ui\.js\?v=echo-oauth-visible-2/);
 assert.match(page,/auth\.css\?v=echo-oauth-visible-2/);
});
