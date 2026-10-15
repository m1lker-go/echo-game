import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/utils/SkeletonUtils.js';
import { bindPlayerControls, updatePlayerMovement } from './player-controls.js';
import { updateCharacterFacing } from './character-facing.js';

const canvas = document.querySelector('#world');
const modelCanvas = document.querySelector('#models');
const ctx = canvas.getContext('2d', { alpha: true });
const energyText = document.querySelector('#energy');
const coordsText = document.querySelector('#coords');
const connectionDot = document.querySelector('#connection-dot');
