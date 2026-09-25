// Runs one generator search off the main thread, streaming its reports.
import { search } from './generator.js';

self.addEventListener('message', ({ data }) => search(data, report => self.postMessage(report)));
