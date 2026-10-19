'use strict';
// Shared server-side nickname rules. Do not rely on browser validation.
const MIN_LENGTH=3, MAX_LENGTH=20;
const ALLOWED=/^[A-Za-zА-Яа-яЁё0-9_-]+$/u;
// Targeted moderation list: avoid broad substrings that block innocent names.
const { containsForbiddenWords } = require('./forbidden-words');
function validateNickname(value){
 if(typeof value!=='string')return {ok:false,reason:'invalid'};
 // Reject non-canonical input rather than silently transforming it.
 const normalized=value.normalize('NFKC');
 if(value!==normalized)return {ok:false,reason:'invalid'};
 if(value.length<MIN_LENGTH||value.length>MAX_LENGTH||!ALLOWED.test(value))return {ok:false,reason:'invalid'};
 const scan=value.toLocaleLowerCase('ru-RU').replace(/[_-]/g,'');
 if(containsForbiddenWords(scan))return {ok:false,reason:'forbidden'};
 return {ok:true,value};
}
module.exports={validateNickname,MIN_LENGTH,MAX_LENGTH};
