const balance=document.getElementById('echo-shop-balance-value');
let requestNumber=0;
async function updateShopBalance(){
 const id=++requestNumber;
 if(!balance)return;
 balance.textContent='…';
 try{
  const user=await window.ECHOAuth?.getMe?.();
  if(id!==requestNumber)return;
  const coins=Number(user?.coins);
  balance.textContent=user&&Number.isFinite(coins)?String(Math.max(0,Math.trunc(coins))):'—';
 }catch(error){
  if(id!==requestNumber)return;
  balance.textContent='—';
  console.warn('[echo shop] balance unavailable',error);
 }
}
document.getElementById('menu-shop')?.addEventListener('click',updateShopBalance);
