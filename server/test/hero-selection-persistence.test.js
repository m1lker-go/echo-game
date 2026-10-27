'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../../client');
const policySource=fs.readFileSync(path.join(root,'hero-selection-policy.js'),'utf8');
const menu=fs.readFileSync(path.join(root,'menu.js'),'utf8');
const game=fs.readFileSync(path.join(root,'game.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('Registered claimed heroes and VK Mini App heroes are preserved during asynchronous authentication',async()=>{
 const {shouldDeferHeroFallback}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(policySource));
 assert.equal(shouldDeferHeroFallback({registered:true,collectionReady:false,identityPending:false}),true);
 assert.equal(shouldDeferHeroFallback({registered:true,collectionReady:true,identityPending:false}),false);
 assert.equal(shouldDeferHeroFallback({registered:false,collectionReady:false,identityPending:true}),true);
 assert.equal(shouldDeferHeroFallback({registered:false,collectionReady:false,identityPending:false}),false);
});

test('Menu never treats pending or failed inventory fetch as revocation',()=>{
 assert.match(menu,/shouldDeferHeroFallback\(\{registered:accessRegistered,collectionReady:heroCollectionReady,identityPending:vkIdentityPending\}\)/);
 assert.match(menu,/heroCollectionReady=true;\s*ensureUnlockedSelection\(\)/);
 assert.match(menu,/token!==localStorage\.getItem\('echo\.authToken'\)/);
 assert.match(menu,/heroCollectionRequest\+\+; \/\/ Invalidate pending lookups/);
 assert.match(menu,/if\(accessRegistered&&!heroCollectionReady\)await loadHeroCollection\(\)/);
 assert.match(menu,/echo:hero-selection-updated/);
 assert.doesNotMatch(menu,/catch\(err\)\{console\.warn\('\[echo heroes\] Collection unavailable',err\);heroCollection=\{\}/);
});

test('In-game local character follows current selected model and authoritative server skin',()=>{
 assert.match(game,/let selectedModel=ALLOWED_MODELS\.has\(localStorage\.getItem\('echo\.selectedModel'\)\)/);
 assert.match(game,/if\(loadId!==localModelLoadId\)return/);
 assert.match(game,/document\.addEventListener\('echo:hero-selection-updated'/);
 assert.match(game,/if\(p\.id===state\.socket\.id\)\{applyGameHero\(p\.skin\)/);
 assert.match(game,/createLocalModel\(file\)/);
 assert.match(html,/menu\.js\?v=echo-render-budget-1/);
 assert.match(html,/game\.js\?v=echo-energy-mobility-1/);
});
