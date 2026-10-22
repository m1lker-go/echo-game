// The semi-transparent protective dome is purely visual.
// Server PvP gating uses the signed-in player's server-side shieldUntil.
export function attachSpawnShield(THREE,root){
 if(!root||root.userData.echoSpawnShield)return;
 const holder=new THREE.Group();
 const dome=new THREE.Mesh(
  new THREE.SphereGeometry(44,32,16,0,Math.PI*2,0,Math.PI/2),
  new THREE.MeshBasicMaterial({color:0x86dfff,transparent:true,opacity:.17,
   side:THREE.DoubleSide,depthWrite:false,depthTest:true})
 );
 dome.scale.y=1.65;dome.position.y=-20;dome.renderOrder=3;holder.add(dome);
 const rim=new THREE.Mesh(
  new THREE.TorusGeometry(44,1.1,6,48),
  new THREE.MeshBasicMaterial({color:0xb9f5ff,transparent:true,opacity:.46,depthWrite:false})
 );
 rim.rotation.x=Math.PI/2;rim.position.y=-20;rim.renderOrder=4;holder.add(rim);
 holder.visible=false;root.add(holder);root.userData.echoSpawnShield=holder;
}
export function updateSpawnShield(root,shieldUntil,now=Date.now()){
 const dome=root?.userData?.echoSpawnShield;
 if(dome)dome.visible=Number.isFinite(shieldUntil)&&shieldUntil>now;
}
