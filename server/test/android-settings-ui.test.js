'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../../android/app/src/main/java/ru/echo/game');
const screens=fs.readFileSync(path.join(root,'EchoScreens.kt'),'utf8');
const auth=fs.readFileSync(path.join(root,'EchoAuthSession.kt'),'utf8');
const main=fs.readFileSync(path.join(root,'MainActivity.kt'),'utf8');

test('native settings use integrated account row and site font throughout',()=>{
 assert.match(screens,/FontFamily\(Font\(R\.font\.echo_superxp\)\)/);
 assert.doesNotMatch(screens,/fontFamily = FontFamily\.SansSerif/);
 assert.match(screens,/Row\(\s*modifier = Modifier\.weight\(1f\)\.height\(css\.settingsButtonHeight\)/);
 assert.match(screens,/contentDescription = tr\(audio, "Изменить имя"/);
 assert.match(screens,/EchoButton\(\s*tr\(audio, "ВЫЙТИ ИЗ АККАУНТА"/);
 assert.match(screens,/selected = true, height = css\.settingsButtonHeight/);
});
test('account deletion is a small trash square alongside Clear Cache',()=>{
 const trash=screens.indexOf('contentDescription = tr(audio, "Удалить аккаунт"');
 const cache=screens.indexOf('tr(audio, "ОЧИСТИТЬ КЭШ ИГРЫ"');
 assert.ok(trash>0 && cache>trash);
 assert.match(screens,/Modifier\.size\(css\.settingsButtonHeight\)/);
 assert.match(screens,/EchoSettingsIcon\(isTrash = true\)/);
 assert.match(screens,/if \(auth\.nickname != null\)/);
 assert.doesNotMatch(screens,/EchoButton\(\s*if \(auth\.busy\) tr\(audio, "ВЫПОЛНЯЕТСЯ ОПЕРАЦИЯ/);
 assert.match(screens,/onDeleteAccount\(\)/);
 assert.match(screens,/Все персонажи, ECHO Coin, задания и игровой прогресс будут потеряны/);
});
test('nickname pencil validates and explicitly confirms before sending to server',()=>{
 assert.match(screens,/EchoNicknamePattern\.matches\(value\)/);
 assert.match(screens,/nicknameEditor = false\s*if \(value != auth\.nickname\) nicknameConfirmation = true/);
 assert.match(screens,/if \(nicknameConfirmation\)/);
 assert.match(screens,/onChangeNickname\(nicknameDraft\.trim\(\)\)/);
 assert.match(screens,/BasicTextField\(/);
 assert.match(auth,/request\("POST", "nickname\/validate", body = body, token = token\)/);
 assert.match(auth,/request\("POST", "nickname", body = body, token = token\)/);
 assert.match(main,/echoAuth\.changeNickname\(session, value\)/);
 assert.match(main,/echoAuth\.updateNickname\(newName\)/);
});
