// Visual only: the server decides whether PvP protection is active.
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
  map:texture,color:0xffffff,transparent:true,opacity:0.88,
  depthWrite:false,depthTest:false
 }));
 // Billboard is proportional to the character's world dimensions, not pixels.
 dome.scale.set(138,122,1);
 dome.position.set(0,-8,0);
 dome.renderOrder=5;
 holder.add(dome);
 holder.visible=false;
 root.add(holder);
 root.userData.echoSpawnShield=holder;
}
export function updateSpawnShield(root,shieldUntil,now=Date.now()){
 const dome=root?.userData?.echoSpawnShield;
 if(dome)dome.visible=Number.isFinite(shieldUntil)&&shieldUntil>now;
}
