// Runs the solver off the main thread, so a large search never freezes editing.
import { minMoves } from './solver.js';

self.addEventListener('message', ({ data }) => self.postMessage(minMoves(data)));
