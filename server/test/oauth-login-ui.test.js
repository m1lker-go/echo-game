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
test('authenticated users do not see account-link buttons in settings',()=>{
 const code=read('auth-ui.js');
 const css=read('auth.css');
 assert.doesNotMatch(code,/echo-oauth-links/);
 assert.doesNotMatch(code,/oauthButton\('(?:yandex|google)',true\)/);
 assert.doesNotMatch(css,/echo-oauth-links/);
});
test('browser refreshes OAuth client assets after the visibility fix',()=>{
 const page=read('index.html');
 assert.match(page,/auth-ui\.js\?v=echo-oauth-no-link-1/);
 assert.match(page,/auth\.css\?v=echo-oauth-no-link-1/);
});
