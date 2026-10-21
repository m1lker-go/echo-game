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
window.addEventListener('echo:shop-balance-refresh',updateShopBalance);

const premiumPrice=document.getElementById('echo-premium-price');
function updatePremiumPrice(){
  // VK launch parameters are supplied by the VK Mini Apps container, not by ECHO login.
  const params=new URLSearchParams(window.location.search);
  const vkAppId=params.get('vk_app_id');
  const vkPlatform=params.get('vk_platform');
  const inVKMiniApp=window.isVKMiniApp===true||Boolean(vkAppId&&vkPlatform);
  const price=inVKMiniApp?'40 '+(document.documentElement.lang?.startsWith('en')?'VK votes':'голосов VK'):'250 ₽';
  if(premiumPrice)premiumPrice.textContent=price;
}
updatePremiumPrice();
document.addEventListener('echo:language-changed',updatePremiumPrice);
window.addEventListener('echo:language-changed',updatePremiumPrice);
