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
 assert.match(code,/intro\.textContent=t\('login_select_method','Выберите способ входа'\)/);
 assert.match(code,/providers\.append\(oauthMethods,loginWidget\)/);
 assert.match(code,/styles:\{borderRadius:12,height:56\}/);
 assert.match(code,/const vkList=loginWidget\?\.querySelector\('\.VkIdSdk_oauth_list'\)/);
 assert.match(code,/if\(yandex&&google\)vkList\.prepend\(yandex,google\)/);
 assert.match(code,/button\.dataset\.configured=String\(ready\)/);
 assert.match(code,/startOAuth\(provider,link\)/);
 // Clicking Yandex must call the real ECHO OAuth start route even if config
 // was previously false before the operator updated the server .env.
 assert.match(code,/request\('oauth\/'\+provider\+'\/start'/);
 assert.doesNotMatch(code,/if\(button\?\.dataset\.configured==='false'\)/);
 assert.match(code,/provider==='google'\?'https:\/\/accounts\.google\.com':'https:\/\/oauth\.yandex\.ru'/);
});
test('ECHO OAuth login buttons have styles within the body-level modal portal',()=>{
 const css=read('auth.css');
 assert.match(css,/\.echo-modal-overlay \.echo-oauth-methods\{/);
 assert.match(css,/\.echo-login-providers\{\s*display:block/);
 assert.match(css,/\.VkIdSdk_oauth_link_text\{/);
 assert.match(css,/\.VkIdSdk_oauth_item\{/);
 assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)!important/);
 assert.match(css,/width:100%!important;flex:none!important/);
 assert.match(css,/\.VkIdSdk_oauth_item svg\{/);
 assert.doesNotMatch(css,/(?:^|[;{\s])width:0!important/m);
 assert.match(css,/\.echo-oauth-methods:empty\{display:none\}/);
 assert.match(css,/\.VkIdSdk_oauth_list > \.echo-oauth-button\{/);
 assert.match(css,/\.echo-oauth-icon-google\{/);
 assert.match(css,/\.echo-oauth-icon-yandex\{/);
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
 assert.match(page,/auth-ui\.js\?v=echo-vkid-54853387-1/);
 assert.match(page,/auth\.css\?v=echo-five-shared-row-1/);
});
