// Visual only: the server decides whether PvP protection is active.
// The PNG fades in, holds, and fades out once per second for five seconds.
export function shieldOpacity(shieldUntil,now=Date.now()){
 if(!Number.isFinite(shieldUntil)||shieldUntil<=now)return 0;
 const elapsed=Math.max(0,5000-(shieldUntil-now));
 const phase=(elapsed%1000)/1000;
 if(phase<0.25)return 0.15+(0.6-0.15)*(phase/0.25);
 if(phase<=0.75)return 0.6;
 return 0.6-(0.6-0.15)*((phase-0.75)/0.25);
}
const SHIELD_TEXTURE='./assets/textures/shield.png';
let texture=null;
export function attachSpawnShield(THREE,root){
 if(!root||root.userData.echoSpawnShield)return;
 if(!texture){
  texture=new THREE.TextureLoader().load(SHIELD_TEXTURE);
  texture.colorSpace=THREE.SRGBColorSpace;
 }
 const holder=new THREE.Group();
 const dome=new THREE.Sprite(new THREE.SpriteMaterial({
  map:texture,color:0xffffff,transparent:true,opacity:0.6,
  depthWrite:false,depthTest:false
 }));
 // Billboard is proportional to the character's world dimensions, not pixels.
 dome.scale.set(103.5,91.5,1);
 dome.position.set(0,33.34,0);
 dome.renderOrder=5;
 holder.add(dome);
 holder.visible=false;
 root.add(holder);
 root.userData.echoSpawnShield=holder;
}
export function updateSpawnShield(root,shieldUntil,now=Date.now()){
 const dome=root?.userData?.echoSpawnShield;
 if(!dome)return;
 dome.visible=Number.isFinite(shieldUntil)&&shieldUntil>now;
 if(dome.visible)dome.children[0].material.opacity=shieldOpacity(shieldUntil,now);
}
