'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../../client');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'ios-viewport.js'),'utf8');
const css=fs.readFileSync(path.join(root,'ios-adaptation.css'),'utf8');
const base=fs.readFileSync(path.join(root,'style.css'),'utf8');
test('iPhone viewport helper runs before page layout and overrides 100svh only for iOS',()=>{
 assert.match(html,/vk-mini-bootstrap\.js[^"]*"[^>]*><\/script>\s*<script src="\.\/ios-viewport\.js\?v=echo-ios-compact-1"/);
 assert.match(html,/ios-adaptation\.css\?v=echo-ios-compact-1/);
 assert.match(base,/#game \{[^}]*min-height: 100svh/);
 assert.match(css,/html\.echo-ios-device #game\{[\s\S]*?min-height:0!important/);
 assert.match(css,/var\(--echo-ios-visible-height,100dvh\)/);
});
test('Visible iOS window height is measured from both viewports and updated on rotation and resize',()=>{
 assert.match(js,/window\.visualViewport\?\.height/);
 assert.match(js,/const height=Math\.min\(\.\.\.valid\)/);
 assert.match(js,/setProperty\('--echo-ios-visible-height'/);
 assert.match(js,/window\.visualViewport\?\.addEventListener\('resize'/);
 assert.match(js,/window\.addEventListener\('orientationchange'/);
 assert.match(js,/echo-ios-short-window/);
 assert.match(js,/if\(!ios\)return/);
});
test('Compact iPhone layout has scrollable main menu and playable landscape/portrait touch controls',()=>{
 assert.match(css,/\.menu-main-screen\{[\s\S]*?overflow-y:auto/);
 assert.match(css,/\.menu-main-screen \.menu-buttons>\.menu-button\{[\s\S]*?min-height:34px/);
 assert.match(css,/\.mobile-controls\{[\s\S]*?safe-area-inset-bottom/);
 assert.match(css,/\.joystick\{[\s\S]*?clamp\(76px,24vh,136px\)/);
 assert.match(css,/\.ability-stack\{flex-direction:column;gap:7px\}/);
 assert.match(css,/@media \(orientation:portrait\) and \(max-width:650px\)/);
 assert.match(css,/#echo-rotate-overlay\{display:none!important\}/);
});
