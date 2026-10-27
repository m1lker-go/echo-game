// Global lightweight ECHO notifications. Usage: window.ECHOToast.show('Text').
(() => {
 if(window.ECHOToast)return;
 let node=null,timer=null;
 // Browser fullscreen puts #game in the top layer, above body siblings.
 function mountToast(){
  if(!node)return;
  const host=document.fullscreenElement||document.webkitFullscreenElement||document.body;
  if(node.parentNode!==host)host.appendChild(node);
 }
 function show(message,duration=2000){
  if(!node){
   node=document.createElement('div');
   node.className='echo-toast';
   node.setAttribute('role','status');
   node.setAttribute('aria-live','polite');
  }
  // Reparent every notification, since fullscreen can change between rewards.
  mountToast();
  clearTimeout(timer);
  if(message instanceof Node){node.replaceChildren(message);}else{node.textContent=String(message);}
  node.classList.add('is-visible');
  timer=setTimeout(()=>{node.classList.remove('is-visible');},Math.max(500,Math.min(10000,duration)));
 }
 document.addEventListener('fullscreenchange',mountToast);
 document.addEventListener('webkitfullscreenchange',mountToast);
 window.ECHOToast=Object.freeze({show});
})();
