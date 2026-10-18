import * as THREE from 'three';
const canvas=document.querySelector('#lab'),bar=document.querySelector('#bar'),hint=document.querySelector('#hint');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,.1,100);
camera.position.set(0,.1,11.8);camera.lookAt(0,0,0);
scene.add(new THREE.HemisphereLight(0xd4ebff,0x172033,2.1));
function light(x,y,z,c,p){const l=new THREE.PointLight(c,p,20);l.position.set(x,y,z);scene.add(l)}
light(-3,4,5,0xc9e9ff,85);light(3,-1,4,0x659ac9,45);light(0,3,-3,0xd6eeff,65);
const group=new THREE.Group();scene.add(group);
const frontMat=new THREE.MeshPhysicalMaterial({color:0x254e78,metalness:.75,roughness:.26,side:THREE.DoubleSide,clearcoat:1,clearcoatRoughness:.23});
const rearMat=new THREE.MeshPhysicalMaterial({color:0xb2cfdf,metalness:.75,roughness:.23,side:THREE.DoubleSide,clearcoat:1});
const edgeMat=new THREE.MeshStandardMaterial({color:0x99bbd4,metalness:.7,roughness:.26,side:THREE.DoubleSide});
const darkMat=new THREE.MeshStandardMaterial({color:0x07121e,roughness:.75,side:THREE.DoubleSide});
const W=3,H=5.05,TOP=2.52,SEAM=2.02,LEFT=-1.5,RIGHT=1.5;
const pack=new THREE.Group();group.add(pack);
function mesh(geometry,material,parent=pack){const m=new THREE.Mesh(geometry,material);parent.add(m);return m}
function sheet(x0,x1,y0,y1,z,material,segments=30){
 const vertices=[],indices=[],uv=[];for(let j=0;j<=segments;j++){const yy=y0+(y1-y0)*j/segments;for(let i=0;i<=8;i++){
 const xx=x0+(x1-x0)*i/8;const fold=Math.sin((i/8)*Math.PI*6+j*.46)*.018 + Math.sin(j*.3+i)*.012;
 vertices.push(xx,yy,z+fold);uv.push(i/8,j/segments);
 }}
 for(let j=0;j<segments;j++)for(let i=0;i<8;i++){const a=j*9+i,b=a+9;indices.push(a,b,a+1,b,b+1,a+1)}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return mesh(g,material);
}
sheet(LEFT,RIGHT,-TOP,SEAM,.14,frontMat);sheet(LEFT,RIGHT,-TOP,SEAM,-.15,rearMat);
sheet(LEFT,RIGHT,-TOP,-2.23,.17,edgeMat,7);
const inside=mesh(new THREE.PlaneGeometry(W,.18),darkMat);inside.position.set(0,SEAM-.01,.13);
const side=new THREE.BoxGeometry(.055,H-.5,.29);
const ls=mesh(side,edgeMat);ls.position.set(LEFT+.024,-.23,0);
const rs=mesh(side,edgeMat);rs.position.set(RIGHT-.024,-.23,0);
const topBack=mesh(new THREE.PlaneGeometry(W,.48),rearMat);topBack.position.set(0,2.27,-.14);
function makeGeometry(vertices,uv,indices){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
function zig(t){return 0.028*(1-2*Math.abs((t*22)%1-.5));}
function flatSeal(start){
 const vertices=[],uv=[],indices=[],N=Math.max(8,Math.ceil((RIGHT-start)*46));
 for(let i=0;i<=N;i++){
 const x=start+(RIGHT-start)*i/N,yy=TOP-zig((x-LEFT)/W);
 vertices.push(x,SEAM,.19,x,yy,.19);uv.push(i/N,0,i/N,1);
 if(i<N){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2)}
 }
 return makeGeometry(vertices,uv,indices);
}
let seal=mesh(flatSeal(LEFT),frontMat);
let flap=mesh(new THREE.BufferGeometry(),rearMat);
let progress=0,dragging=false,rotated=false,lift=0;
function foldedGeometry(p){
 const end=LEFT+W*p,span=W*p;
 const N=Math.max(12,Math.ceil(p*100)),vertices=[],uv=[],indices=[];
 // Two long edges of one rectangular foil strip follow the SAME curved centerline.
 // The attached end meets the stationary right-hand seam exactly.
 for(let i=0;i<=N;i++){
 const u=i/N,len=span*u,loop=Math.min(1,span/1.05);
 const angle=u*Math.PI*1.72*loop;
 const radius=Math.min(.44,.12+span*.12);
 const x=end-len*.66+radius*Math.sin(angle);
 const y=SEAM+radius*(1-Math.cos(angle)) + lift*u*.24;
 const z=.20+.13*Math.sin(angle)+.24*u;
 const topY=y+.48*Math.cos(angle)+zig((end-len-LEFT)/W)*.75;
 const topZ=z+.48*Math.sin(angle);
 vertices.push(x,y,z,x,topY,topZ);uv.push(u,0,u,1);
 if(i<N){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3)}
 }
 return makeGeometry(vertices,uv,indices);
}
function replaceGeom(m,g){m.geometry.dispose();m.geometry=g}
function redraw(){
 const edge=LEFT+W*progress;
 replaceGeom(seal,flatSeal(edge));
 replaceGeom(flap,foldedGeometry(progress));
 flap.visible=progress>.008;
 bar.style.width=(progress*100).toFixed(1)+'%';
 hint.textContent=progress>=.995?'Пак открыт. Нажми «Повторить», чтобы попробовать снова.':progress>0?'Продолжай вести вправо — или отпусти, разрыв сохранится.':'Потяни левый верхний угол вправо вдоль шва.';
}
redraw();
function rectResize(){const w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
window.addEventListener('resize',rectResize);rectResize();
let prior=performance.now();
function frame(now){const dt=Math.min(.05,(now-prior)/1000);prior=now;
 if(!dragging && !rotated)group.rotation.y+=(0-group.rotation.y)*Math.min(1,dt*4);
 renderer.render(scene,camera);requestAnimationFrame(frame)}
requestAnimationFrame(frame);
function pointerToPack(e){const rect=canvas.getBoundingClientRect(),nX=(e.clientX-rect.left)/rect.width*2-1,nY=1-(e.clientY-rect.top)/rect.height*2;
 const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(nX,nY),camera);
 const plane=new THREE.Plane(new THREE.Vector3(0,0,1),-.3),at=new THREE.Vector3();
 ray.ray.intersectPlane(plane,at);return at;
}
canvas.addEventListener('pointerdown',e=>{
 const q=pointerToPack(e);
 if(progress>=1||Math.abs(q.y-SEAM)>.8)return;
 if(progress===0 && q.x>LEFT+.8)return;
 dragging=true;canvas.setPointerCapture(e.pointerId);updatePointer(e);
});
function updatePointer(e){if(!dragging)return;const q=pointerToPack(e);
 progress=Math.max(progress,Math.max(0,Math.min(1,(q.x-LEFT)/W)));
 lift=Math.max(-.5,Math.min(.5,q.y-SEAM));redraw();}
canvas.addEventListener('pointermove',updatePointer);
canvas.addEventListener('pointerup',()=>dragging=false);
canvas.addEventListener('pointercancel',()=>dragging=false);
document.querySelector('#reset').addEventListener('click',()=>{progress=0;lift=0;group.rotation.y=0;rotated=false;redraw()});
document.querySelector('#rotate').addEventListener('click',()=>{rotated=!rotated;group.rotation.y=rotated?.48:0});
