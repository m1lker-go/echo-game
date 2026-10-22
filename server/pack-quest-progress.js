'use strict';
// Daily pack quests are awarded only by server-confirmed card grants.
// All changes are made via the caller's purchase transaction, so payment,
// fragments, and daily mission progress commit or roll back together.
const PACK_COLUMNS=Object.freeze({coin:'pack_coin_opened',premium:'pack_premium_opened'});
const TIME_ZONE=process.env.DAILY_TIME_ZONE||'Europe/Moscow';
function dailyPackDate(date=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{
  timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(date);
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return values.year+'-'+values.month+'-'+values.day;
}
async function recordPackOpened(transaction,accountId,type,date=new Date()){
 const column=PACK_COLUMNS[type];
 if(!column||!accountId||!transaction?.query)throw new TypeError('Invalid confirmed pack opening');
 const dateKey=dailyPackDate(date);
 // Column is selected exclusively from a fixed whitelist, never from the client.
 await transaction.query(
  'INSERT INTO echo_daily_activity(profile_id,activity_date,'+column+') '+
  'VALUES($1,$2::date,1) '+
  'ON CONFLICT(profile_id,activity_date) DO UPDATE SET '+
  column+'=LEAST(echo_daily_activity.'+column+'+1,100000),updated_at=NOW()',
  [String(accountId),dateKey]
 );
}
module.exports={recordPackOpened,dailyPackDate,PACK_COLUMNS};
