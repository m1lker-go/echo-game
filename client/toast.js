// Global lightweight ECHO notifications. Usage: window.ECHOToast.show('Text').
(() => {
 if(window.ECHOToast)return;
 let node=null,timer=null;
 function show(message,duration=2000){
  if(!node){
   node=document.createElement('div');
   node.className='echo-toast';
   node.setAttribute('role','status');
   node.setAttribute('aria-live','polite');
   document.body.append(node);
  }
  clearTimeout(timer);
  if(message instanceof Node){node.replaceChildren(message);}else{node.textContent=String(message);}
  node.classList.add('is-visible');
  timer=setTimeout(()=>{node.classList.remove('is-visible');},Math.max(500,Math.min(10000,duration)));
 }
 window.ECHOToast=Object.freeze({show});
})();