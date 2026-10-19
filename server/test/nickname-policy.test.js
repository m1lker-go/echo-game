'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateNickname}=require('../nickname-policy');
test('accepts ordinary Latin and Cyrillic nicknames',()=>{
 for(const value of ['M1lkero','EXO_2026','Игрок-777','Mira2026'])assert.equal(validateNickname(value).ok,true,value);
});
test('rejects HTML, JavaScript, SQL punctuation and control characters',()=>{
 for(const value of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','javascript:alert(1)','\' OR 1=1 --','Tom&Jerry','abc\\ndef','abc\u0000def','a'.repeat(21),'ab','test name'])assert.equal(validateNickname(value).ok,false,value);
});
test('rejects Unicode tricks and profanity',()=>{
 for(const value of ['ＡＢＣ','a\u200Bbc','a\u202Ebc','fuck','F_U_C_K','сука','хуйло'])assert.equal(validateNickname(value).ok,false,value);
});
test('rejects non-string payloads',()=>{
 for(const value of [null,{},[],123,true])assert.equal(validateNickname(value).ok,false);
});
