'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../client/game.js'), 'utf8');

// Evaluate the actual return-to-menu handler in isolation: the rest of game.js
// needs WebGL, a server connection, and a browser to initialize.
const handler = source.match(/function returnToMenu\(\)\{([\s\S]*?)\}gameExitButton\?\.addEventListener/);
assert.ok(handler, 'Game must register an accessible return-to-menu handler');

function runExit(initiallyDefeated) {
  const state = {
    menuHidden: true,
    inBattle: true,
    mainHidden: true,
    released: 0,
    dispatched: []
  };
  const defeatScreen = {hidden: !initiallyDefeated};
  const sandbox = {
    defeatScreen,
    releaseGameSocket: () => { state.released++; },
    Event: class { constructor(type) { this.type = type; } },
    document: {
      querySelector: (selector) => ({
        '#main-menu': {classList: {remove: cls => {
          if (cls === 'is-hidden') state.menuHidden = false;
        }}},
        '#menu-main': {removeAttribute: attr => {
          if (attr === 'hidden') state.mainHidden = false;
        }}
      })[selector] || null,
      getElementById: id => id === 'game' ? {
        classList: {remove: cls => {
          if (cls === 'echo-in-battle') state.inBattle = false;
        }}
      } : null,
      dispatchEvent: event => state.dispatched.push(event.type)
    }
  };
  vm.runInNewContext('function returnToMenu(){' + handler[1] + '}\nreturnToMenu();', sandbox);
  return {state, defeatScreen};
}

test('defeat Back to menu hides the overlay and restores usable main menu', () => {
  const {state, defeatScreen} = runExit(true);
  assert.equal(defeatScreen.hidden, true, 'Defeat overlay must not cover menu');
  assert.equal(state.menuHidden, false);
  assert.equal(state.mainHidden, false);
  assert.equal(state.inBattle, false);
  assert.equal(state.released, 1);
  assert.deepEqual(state.dispatched, ['echo:returned-to-menu']);
});

test('regular game exit still restores menu with a closed socket', () => {
  const {state, defeatScreen} = runExit(false);
  assert.equal(defeatScreen.hidden, true);
  assert.equal(state.menuHidden, false);
  assert.equal(state.inBattle, false);
  assert.equal(state.released, 1);
});
